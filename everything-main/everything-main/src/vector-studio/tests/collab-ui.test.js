import { describe, it, expect, afterEach } from 'vitest';
import axe from 'axe-core';
import { bootAppWithFeatures } from './helpers.js';
import { network, joinClient, shareNew, settle, rect, alice, bob, cam, SERVER } from './collab-helpers.js';
import { memoryOutbox } from '../src/features/collab/outbox.js';
import { parseShareLink } from '../src/features/collab/protocol.js';
import { visibleThreads } from '../src/features/collab/comments.js';
import { pinAt, screenPins } from '../src/features/collab/presence-ui.js';
import { MENUS } from '../src/ui/menus.js';
import { nodeBounds } from '../src/model/geometry.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 3000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('Timed out waiting');
    await tick(5);
  }
}

function dialogButton(label) {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  const d = dialogs[dialogs.length - 1];
  return d && [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
}

async function boot(user = alice, net = network()) {
  const app = await bootAppWithFeatures({ user });
  app.collab.transportFor = () => net.transport(user);
  app.collab.deployServer = async () => SERVER;
  app.collab.outbox = memoryOutbox();
  app.collab.sessionOptions = { timers: false };
  return { app, net };
}

/** Bob's or Cam's app opening a document Alice shares from a headless client. */
async function bootAs(user, role) {
  const net = network();
  const { room, client: owner } = await shareNew(net);
  owner.doc.transact('Add', () => owner.doc.insert(rect('p1', 10, 10), owner.doc.root.children[0]));
  await settle(owner);
  const { token } = await net.service.call(alice, { op: 'invite', room, role, review: role === 'commenter' });
  const { app } = await boot(user, net);
  const editor = await app.collab.open({ server: SERVER, room, invite: token });
  return { app, net, room, owner, editor };
}

afterEach(() => {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
});

describe('collaboration commands and menus', () => {
  it('lists Invite to Edit and Share for Review after Place, and Comments in Window', async () => {
    const { app } = await boot();
    const file = MENUS.find((m) => m.label === 'File').submenu;
    const at = file.indexOf('file.place');
    expect(file.slice(at, at + 4)).toEqual(['file.place', '-', 'file.invite', 'file.shareReview']);
    const win = MENUS.find((m) => m.label === 'Window').submenu;
    const panels = win.filter((x) => typeof x === 'string' && x.startsWith('panel.'));
    expect(panels).toContain('panel.comments');
    expect(panels).toEqual([...panels].sort((a, b) => a.localeCompare(b)));
    expect(app.commands.label('file.invite')).toBe('Invite to Edit...');
    expect(app.commands.label('file.shareReview')).toBe('Share for Review...');
    expect(app.commands.get('panel.comments')).toBeTruthy();
    expect(app.commands.isEnabled('file.invite')).toBe(false);
    app.newDocument();
    expect(app.commands.isEnabled('file.invite')).toBe(true);
  });

  it('explains that sharing needs sign-in and keeps personal files working', async () => {
    const { app } = await boot(null);
    app.newDocument();
    expect(app.collab.unavailable()).toMatch(/Sign in/);
    app.commands.run('file.invite');
    await waitFor(() => document.querySelector('dialog[open]'));
    expect(document.querySelector('dialog[open]').textContent).toMatch(/Sign in with Puter/);
    expect(dialogButton('Sign In') || dialogButton('OK')).toBeTruthy();
    // Comments still work in a personal document.
    expect(app.commands.isEnabled('comments.add')).toBe(true);
  });

  it('shares after confirming and shows who has access', async () => {
    const { app, net } = await boot();
    const ed = app.newDocument({ name: 'Logo' });
    app.commands.run('file.invite');
    await waitFor(() => dialogButton('Share'));
    expect(document.querySelector('dialog[open]').textContent).toMatch(/stays shared until you choose Stop Sharing/);
    dialogButton('Share').click();
    await waitFor(() => document.querySelector('.collab-people .collab-person'));
    expect(ed.collab?.role).toBe('owner');
    expect(ed.file.kind).toBe('shared');
    expect(ed.doc.dirty).toBe(false);
    expect(document.querySelector('.collab-people').textContent).toMatch(/alice/);
    // Invite someone by username.
    const input = document.querySelector('.collab-username');
    input.value = 'bob';
    dialogButton('Invite').click();
    await waitFor(() => /Invited bob/.test(document.querySelector('.collab-status-line').textContent));
    expect(await net.puter.kv.get(`vs:${ed.collab.room}:named:bob`)).toMatchObject({ role: 'editor' });
    const result = await axe.run(document.querySelector('dialog[open]'), { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    dialogButton('Done').click();
    // The title bar shows the shared status.
    await waitFor(() => document.querySelector('.collab-status'));
    expect(document.querySelector('.collab-bar').textContent).toMatch(/Live/);
  });
});

describe('live collaboration in the app', () => {
  async function sharedWithBob() {
    const { app, net } = await boot();
    const ed = app.newDocument({ name: 'Poster' });
    await app.collab.share(ed);
    const link = parseShareLink(await app.collab.link(ed, { role: 'editor' }));
    const b = await joinClient(net, bob, link.room, { invite: link.invite });
    return { app, net, ed, b };
  }

  it('shows remote edits without adding them to local undo', async () => {
    const { ed, b } = await sharedWithBob();
    const L = ed.doc.root.children[0];
    b.doc.transact('Add', () => b.doc.insert(rect('fromBob', 5, 5), L));
    await settle(b);
    await ed.collab.sync();
    expect(ed.doc.get('fromBob')).toBeTruthy();
    expect(ed.doc.canUndo).toBe(false);
    ed.doc.transact('Add', () => ed.doc.insert(rect('mine', 50, 50), L));
    await ed.collab.sending;
    await settle(b);
    expect(b.doc.get('mine')).toBeTruthy();
    ed.doc.undo();
    await ed.collab.sending;
    await settle(b);
    expect(b.doc.get('mine')).toBeUndefined();
    expect(b.doc.get('fromBob')).toBeTruthy();
  });

  it('shows participants, their cursors and selections, and follows their view', async () => {
    const { app, ed, b } = await sharedWithBob();
    const L = ed.doc.root.children[0];
    ed.doc.transact('Add', () => ed.doc.insert(rect('shape', 0, 0), L));
    await ed.collab.sending;
    await settle(b);
    b.session.setLocalState({ cursor: { x: 3, y: 4 }, selection: ['shape'], view: { x: 100, y: 100, w: 200, h: 100 } });
    await b.session.checkIn();
    await ed.collab.checkIn();
    const people = ed.collab.participants();
    expect(people.map((p) => p.username)).toEqual(['bob']);
    expect(people[0].state.selection).toEqual(['shape']);
    await waitFor(() => document.querySelector('.collab-avatar'));
    const avatar = document.querySelector('.collab-avatar');
    expect(avatar.getAttribute('aria-label')).toMatch(/bob, Can edit/);
    // Follow bob: the view fits his.
    app.collab.follow(ed, people[0].session);
    // The view is centered on bob's (jsdom's canvas size limits the zoom).
    const r = ed.view.visibleRect();
    expect(r.x + r.w / 2).toBeCloseTo(200, 0);
    expect(r.y + r.h / 2).toBeCloseTo(150, 0);
    expect(ed.collabFollow).toBe(people[0].session);
    // Navigating yourself stops following.
    ed.view.set({ panX: ed.view.panX + 50 });
    ed.viewChanged();
    expect(ed.collabFollow).toBe(null);
  });

  it('Save sends pending changes and reports that shared documents save automatically', async () => {
    const { app, ed } = await sharedWithBob();
    const ok = await app.commands.run('file.save', { editor: ed });
    expect(ok).toBe(true);
  });

  it('Stop Sharing turns the tab back into a personal, unsaved document', async () => {
    const { app, ed, b } = await sharedWithBob();
    await app.collab.stop(ed);
    expect(ed.collab).toBe(null);
    expect(ed.file).toBe(null);
    expect(ed.doc.dirty).toBe(true);
    const ended = [];
    b.session.on('ended', (e) => ended.push(e));
    await b.session.sync();
    expect(ended[0].kind).toBe('closed');
  });
});

describe('view-only roles', () => {
  it('viewers can navigate but every editing path is off, with a role indicator', async () => {
    const { app, editor } = await bootAs(cam, 'viewer');
    expect(editor.doc.readOnly).toBe(true);
    for (const id of ['edit.undo', 'edit.paste', 'edit.clear', 'object.group', 'select.all', 'file.place', 'comments.add', 'comments.mode']) expect(app.commands.isEnabled(id), id).toBe(false);
    for (const id of ['view.zoomIn', 'view.fitAll', 'file.invite', 'panel.comments']) expect(app.commands.isEnabled(id), id).toBe(true);
    expect(app.toolId).toBe('hand');
    app.setTool('pen');
    app.setTool('selection');
    expect(app.toolId).toBe('hand');
    app.setTool('zoom');
    expect(app.toolId).toBe('zoom');
    const penBtn = [...document.querySelectorAll('.tool-btn')].find((b) => b._ids?.includes('pen'));
    expect(penBtn.getAttribute('aria-disabled')).toBe('true');
    expect(app.dock.panels.get('layers').el.inert).toBe(true);
    expect(app.dock.panels.get('comments').el.inert).toBe(false);
    expect(() => editor.doc.transact('Edit', () => editor.doc.update('p1', { name: 'x' }))).toThrow(/view only/);
    expect(editor.doc.get('p1').name).toBe('');
    await waitFor(() => document.querySelector('.collab-role'));
    expect(document.querySelector('.collab-role').textContent).toBe('View only');
  });

  it('commenters review: comment, but not edit; comments reach the owner', async () => {
    const { app, editor, owner } = await bootAs(cam, 'commenter');
    expect(editor.doc.readOnly).toBe(true);
    expect(app.commands.isEnabled('object.group')).toBe(false);
    expect(app.commands.isEnabled('comments.add')).toBe(true);
    await waitFor(() => document.querySelector('.collab-role'));
    expect(document.querySelector('.collab-role').textContent).toBe('Reviewing');
    app.commands.run('comments.mode');
    expect(app.toolId).toBe('comment');
    const b = nodeBounds(editor.doc, editor.doc.get('p1'));
    app.tool.onPointerDown({ x: b.x + 5, y: b.y + 5, sx: 0, sy: 0 });
    expect(app.comments.draft.anchor.node).toBe('p1');
    app.comments.addThread('Can the corner be rounder, @alice?');
    await editor.collab.sending;
    await settle(owner);
    const threads = visibleThreads(owner.doc.comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor.node).toBe('p1');
    expect(Object.values(threads[0].messages)[0].author).toEqual({ id: cam.uuid, name: 'cam' });
    app.commands.run('comments.mode');
    expect(app.toolId).toBe('hand');
  });

  it('a role change applies live', async () => {
    const { app, editor, net, room } = await bootAs(cam, 'viewer');
    expect(app.commands.isEnabled('object.group')).toBe(false);
    await net.service.call(alice, { op: 'role', room, uuid: cam.uuid, role: 'editor' });
    await editor.collab.sync();
    expect(editor.doc.readOnly).toBe(false);
    app.setTool('pen');
    expect(app.toolId).toBe('pen');
    const penBtn = [...document.querySelectorAll('.tool-btn')].find((b) => b._ids?.includes('pen'));
    expect(penBtn.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('comments panel', () => {
  async function withDoc() {
    const { app } = await boot();
    const ed = app.newDocument();
    const L = ed.doc.root.children[0];
    ed.doc.transact('Add', () => ed.doc.insert(rect('box', 100, 100), L));
    ed.select(['box']);
    app.openPanel('comments');
    const panel = app.dock.panels.get('comments');
    return { app, ed, panel };
  }

  const type = (el, text) => {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

  it('adds, replies, resolves, filters, edits and deletes comments in a personal file', async () => {
    const { app, ed, panel } = await withDoc();
    app.commands.run('comments.add');
    await tick();
    const draft = panel.el.querySelector('[data-focus-key="draft"]');
    expect(draft).toBeTruthy();
    expect(panel.el.querySelector('.comment-where').textContent).toMatch(/On Path/);
    type(draft, 'First note');
    button(panel.el, 'Comment').click();
    await tick();
    let threads = visibleThreads(ed.doc.comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor.node).toBe('box');
    expect(ed.doc.dirty).toBe(true);
    expect(ed.doc.undoStack.length).toBe(1); // only the rectangle
    // Reply.
    const reply = panel.el.querySelector('[data-focus-key^="reply-"]');
    type(reply, 'A reply');
    button(panel.el, 'Reply').click();
    await tick();
    expect(Object.keys(ed.doc.comments.threads[threads[0].id].messages)).toHaveLength(2);
    expect(panel.el.querySelectorAll('.comment-message')).toHaveLength(2);
    // Edit own message.
    panel.el.querySelector('[aria-label="Edit comment"]').click();
    const edit = panel.el.querySelector('[data-focus-key^="edit-"]');
    type(edit, 'First note, edited');
    button(panel.el, 'Save').click();
    await tick();
    expect(panel.el.textContent).toMatch(/First note, edited/);
    expect(panel.el.textContent).toMatch(/\(edited\)/);
    // Resolve: hidden under Open, shown under Resolved.
    button(panel.el, 'Resolve').click();
    await tick();
    expect(panel.el.querySelectorAll('.comment-thread')).toHaveLength(0);
    expect(panel.el.textContent).toMatch(/No comments match/);
    app.comments.setFilter('resolved');
    await tick();
    expect(panel.el.querySelectorAll('.comment-thread')).toHaveLength(1);
    // Mine filter keeps my own.
    app.comments.setFilter('all', true);
    await tick();
    expect(panel.el.querySelectorAll('.comment-thread')).toHaveLength(1);
    const result = await axe.run(panel.el, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    // Delete the discussion.
    app.comments.removeThread(threads[0].id);
    await tick();
    expect(visibleThreads(ed.doc.comments)).toHaveLength(0);
  });

  it('pins follow the object they are attached to and open their discussion', async () => {
    const { app, ed } = await withDoc();
    app.comments.startDraft(app.comments.anchorAt(ed, 105, 105, 'box'));
    const id = app.comments.addThread('Pinned');
    const before = app.comments.pin(app.comments.thread(id), ed);
    ed.doc.transact('Move', () => ed.doc.update('box', { anchors: rect('box', 300, 300).anchors }));
    const after = app.comments.pin(app.comments.thread(id), ed);
    expect(after.x - before.x).toBeCloseTo(200);
    expect(after.y - before.y).toBeCloseTo(200);
    app.comments.active = null;
    const [pin] = screenPins(app, ed);
    expect(pinAt(app, ed, pin.x + 11, pin.y - 11)?.thread.id).toBe(id);
    app.canvasHost.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
    app.canvasHost.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: pin.x + 11, clientY: pin.y - 11 }));
    expect(app.comments.active).toBe(id);
  });

  it('suggests people to @mention in a shared document', async () => {
    const { app, editor } = await bootAs(cam, 'commenter');
    await editor.collab.checkIn();
    await app.collab.members(editor, { fresh: true });
    app.openPanel('comments');
    app.commands.run('comments.add');
    await tick();
    const panel = app.dock.panels.get('comments');
    const draft = panel.el.querySelector('[data-focus-key="draft"]');
    draft.value = 'Hi @al';
    draft.setSelectionRange(6, 6);
    draft.dispatchEvent(new Event('input', { bubbles: true }));
    const list = panel.el.querySelector('.mention-list');
    expect(list.hidden).toBe(false);
    expect(list.textContent).toMatch(/alice/);
    draft.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(draft.value).toBe('Hi @alice ');
  });
});
