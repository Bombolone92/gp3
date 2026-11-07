/**
 * Conversation UI (review pass 19), driven in node through
 * tests/helpers/dom.js as the pass-18 file is: a fresh DOM and a fresh
 * module registry for every test, Puter faked at `puter.workers.exec`, the
 * toast, the theme, the modal layer and navigation mocked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({
  confirmDialog: vi.fn(async () => true),
  closeAllModals: vi.fn(),
  openModal: vi.fn(({ content, onClose }) => {
    document.body.append(content);
    const close = vi.fn(() => { content.remove(); onClose?.(); });
    return { close, panel: content, root: content };
  }),
}));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));
vi.mock('../src/lib/archive.js', async (importOriginal) => ({ ...(await importOriginal()), exportWorkspace: vi.fn(), transferWorkspace: vi.fn() }));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a small workspace open in the store: two channels the member is in and two teammates. */
async function boot({ width = 1280, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ width, ...env });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  const { api } = await import('../src/lib/api.js');
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 }, c2: { id: 'c2', name: 'random', count: 3 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 },
      u3: { role: 'member', name: 'Ben Ito', username: 'ben', color: 3 },
    },
  };
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  return { store, api, dom };
}

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  if (store) {
    for (const t of store._readTimers?.values() || []) clearTimeout(t);
    store._readTimers?.clear();
  }
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

describe('two files dropped into the box, the box left before the first has landed', () => {
  const files = [
    { name: 'plan.pdf', size: 1234, type: 'application/pdf' },
    { name: 'notes.txt', size: 99, type: 'text/plain' },
  ];
  const uploaded = files.map((f, i) => ({ id: `f${i + 1}`, ...f }));

  it('shows both in the box opened next and keeps both in the draft, the second as well as the first', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    // The uploads run one after another; each is held until finished here.
    const pending = [];
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise((r) => pending.push(r)));
    const key = `${REF}:c1`;
    const open = () => {
      const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const chips = (box) => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent}${c.classList.contains('uploading') ? ' (uploading)' : ''}`);
    const a = open();
    d.type(a.textarea, 'hello');
    const input = a.el.querySelector('input[type="file"]');
    input.files = files;
    input.dispatchEvent(new Event('change'));
    await d.tick(1);
    // Both take their chip at once; the uploads go one after another, and the
    // second file's turn comes when the first has landed.
    expect(chips(a)).toEqual(['plan.pdf (uploading)', 'notes.txt (uploading)']);
    expect(pending).toHaveLength(1);
    // The reader switches conversation and comes back before the first has landed.
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual(['plan.pdf (uploading)', 'notes.txt (uploading)']);
    pending[0](uploaded[0]);
    await d.tick(2);
    // The second file is on its way now, and the box shows it going up.
    expect(pending).toHaveLength(2);
    expect(chips(b)).toEqual(['plan.pdf', 'notes.txt (uploading)']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(true);
    pending[1](uploaded[1]);
    await d.tick(2);
    expect(chips(b)).toEqual(['plan.pdf', 'notes.txt']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(false);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: uploaded });
    b.destroy();
  });

  it('writes both into the draft when no box is open on the conversation by the time they land', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    const pending = [];
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise((r) => pending.push(r)));
    const key = `${REF}:c1`;
    const a = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: key });
    document.body.append(a.el);
    d.type(a.textarea, 'hello');
    const input = a.el.querySelector('input[type="file"]');
    input.files = files;
    input.dispatchEvent(new Event('change'));
    await d.tick(1);
    a.destroy();
    a.el.remove();
    pending[0](uploaded[0]);
    await d.tick(2);
    pending[1](uploaded[1]);
    await d.tick(2);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: uploaded });
  });
});

describe('a file taken out of the box while it was still going up', () => {
  const file = { name: 'plan.pdf', size: 1234, type: 'application/pdf' };
  const uploaded = { id: 'f1', ...file };
  const setup = async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    let finish = null;
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise((r) => { finish = r; }));
    const key = `${REF}:c1`;
    const open = () => {
      const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const chips = (box) => [...box.el.querySelectorAll('.chip .chip-name')].map((c) => c.textContent);
    const a = open();
    d.type(a.textarea, 'hello');
    const input = a.el.querySelector('input[type="file"]');
    input.files = [file];
    input.dispatchEvent(new Event('change'));
    await d.tick(1);
    expect(chips(a)).toEqual(['plan.pdf']);
    a.el.querySelector('.chip button[aria-label="Remove plan.pdf"]').click();
    expect(chips(a)).toEqual([]);
    return { d, a, open, key, getDraft, chips, finish: () => finish(uploaded) };
  };

  it('does not come back into the box opened next on the conversation, nor land in it', async () => {
    const { d, a, open, key, getDraft, chips, finish } = await setup();
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual([]);
    finish();
    await d.tick(2);
    expect(chips(b)).toEqual([]);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [] });
    b.destroy();
  });

  it('is not written into the draft when it lands with no box open', async () => {
    const { d, a, key, getDraft, finish } = await setup();
    a.destroy();
    a.el.remove();
    finish();
    await d.tick(2);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [] });
  });
});

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });

describe('"Bookmark a file in channel" picked from a message with several files', () => {
  it('writes the channel’s bookmarks as they stand when the file is picked, not as they stood when the menu opened', async () => {
    const { dom: d, api } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000, bookmarks: [{ label: 'Docs', url: 'https://example.com/docs' }] });
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    const update = vi.spyOn(api, 'updateChannel').mockResolvedValue({ channel: {} });
    const files = [{ id: 'f1', name: 'pic.png', size: 10, type: 'image/png' }, { id: 'f2', name: 'plan.pdf', size: 20, type: 'application/pdf' }];
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u3', { attachments: files })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    view.el.querySelector('.msg [aria-label="More actions"]').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Bookmark a file in channel')).click();
    await d.tick(1);
    const pick = [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('plan.pdf'));
    expect(pick).toBeTruthy();
    // While the list of files stands open, another curator's bookmark lands with a poll: the workspace is replaced whole, as the store replaces it.
    const roadmap = { label: 'Roadmap', url: 'https://example.com/roadmap' };
    store.ws = { ...store.ws, channels: { ...store.ws.channels, c1: { ...store.ws.channels.c1, bookmarks: [...store.ws.channels.c1.bookmarks, roadmap] } } };
    store.emit('workspace');
    await d.tick(1);
    pick.click();
    await d.tick(3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][2]).toEqual({ bookmarks: [{ label: 'Docs', url: 'https://example.com/docs' }, roadmap, { label: 'plan.pdf', file: 'f2' }] });
    view.destroy();
  });
});

describe('Enter in the edit box of a message that has files and no words, nothing typed', () => {
  it('closes the box and changes nothing, rather than saying the message cannot be empty', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { startInlineEdit } = await import('../src/ui/message.js');
    const { toast } = await import('../src/ui/toast.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const edit = vi.spyOn(store, 'edit').mockResolvedValue();
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u-me', { text: '', attachments: [{ id: 'f1', name: 'plan.pdf', size: 10, type: 'application/pdf' }] })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    toast.mockClear();
    const row = view.el.querySelector('.msg');
    expect(startInlineEdit(row)).toBe(true);
    const box = row.querySelector('.msg-edit-input');
    expect(box.value).toBe('');
    d.key(box, 'Enter');
    await d.tick(2);
    expect(edit).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(row.querySelector('.msg-edit-input')).toBeNull();
    expect(document.activeElement).toBe(row);
    // Emptied by hand, a message that had words is still refused, as before.
    Object.assign(store.conv('c1').messages[0], { text: 'hello' });
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    const again = view.el.querySelector('.msg');
    expect(startInlineEdit(again)).toBe(true);
    const box2 = again.querySelector('.msg-edit-input');
    d.type(box2, '  ');
    d.key(box2, 'Enter');
    await d.tick(2);
    expect(edit).not.toHaveBeenCalled();
    expect(toast.mock.calls.some((c) => /cannot be empty/.test(c[0]))).toBe(true);
    view.destroy();
  });
});

describe('the Bookmarks section of a channel’s details', () => {
  it('is not drawn, heading and empty card, for someone who cannot add one to a channel with none', async () => {
    const { dom: d } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000, archived: true });
    vi.spyOn(store, 'loadPins').mockResolvedValue([]);
    openDetailsDialog('c1');
    await d.tick(3);
    expect([...document.querySelectorAll('h3')].some((h) => /^Bookmarks/.test(h.textContent))).toBe(false);
    // With a bookmark to show, the section stands, read-only.
    store.ws.channels.c1.bookmarks = [{ label: 'Docs', url: 'https://example.com/docs' }];
    store.emit('workspace');
    await d.tick(3);
    expect([...document.querySelectorAll('h3')].some((h) => h.textContent === 'Bookmarks (1)')).toBe(true);
    expect([...document.querySelectorAll('.details-row')].some((r) => /Edit bookmarks|Add a bookmark/.test(r.textContent))).toBe(false);
  });

  it('offers "Add a bookmark" to a member of a live channel with none, as before', async () => {
    const { dom: d } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    vi.spyOn(store, 'loadPins').mockResolvedValue([]);
    openDetailsDialog('c1');
    await d.tick(3);
    expect([...document.querySelectorAll('h3')].some((h) => h.textContent === 'Bookmarks (0)')).toBe(true);
    expect([...document.querySelectorAll('.details-row')].some((r) => /Add a bookmark/.test(r.textContent))).toBe(true);
  });
});

describe('the Forward dialog’s list of conversations', () => {
  it('leaves out a direct message with someone who has left the workspace, as its own box does', async () => {
    const { dom: d } = await boot();
    const { forwardMessageDialog } = await import('../src/ui/dialogs.js');
    // Ana left; Ben is here; the third is the reader's own space.
    delete store.ws.members.u2;
    store.ws.former = { u2: { name: 'Ana Rocha', username: 'ana', color: 2 } };
    store.me.dms = { d1: { id: 'd1', members: ['u-me', 'u2'] }, d2: { id: 'd2', members: ['u-me', 'u3'] }, d3: { id: 'd3', members: ['u-me'] } };
    forwardMessageDialog(message(1), { permalink: 'https://app.test/#/x', author: { name: 'Ana Rocha' }, conv: 'c1' });
    await d.tick(2);
    const options = [...document.querySelectorAll('.pick-item strong')].map((s) => s.textContent);
    expect(options).toContain('Ben Ito');
    expect(options).toContain('Me (you)');
    expect(options).not.toContain('Ana Rocha');
  });
});

describe('Shift+F10 and the Menu key on a message row', () => {
  const open = async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { startInlineEdit } = await import('../src/ui/message.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), message(2, 'u-me')] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const rows = [...view.el.querySelectorAll('.msg')];
    const menu = () => document.querySelector('.menu[role="menu"]');
    const items = () => [...document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent);
    return { d, view, rows, menu, items, startInlineEdit };
  };

  it('open the row’s menu from the keyboard, and swallow the contextmenu the same press fires on Windows', async () => {
    const { d, view, rows, menu, items } = await open();
    rows[0].focus();
    const ev = d.key(rows[0], 'F10', { shiftKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(menu()).toBeTruthy();
    expect(items().some((t) => /Reply in thread/.test(t))).toBe(true);
    expect(items().some((t) => /Delete message/.test(t))).toBe(false); // Ana's message; the reader is a member
    expect(rows[0].classList.contains('menu-open')).toBe(true);
    // Windows fires contextmenu for the same press: the browser's menu stays shut.
    const cm = new Event('contextmenu', { bubbles: true, cancelable: true });
    rows[0].dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(true);
    expect(document.querySelectorAll('.menu[role="menu"]')).toHaveLength(1);
    await d.tick(1); // the menu listens for its keys a moment after opening (past the press that opened it)
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    expect(menu()).toBeNull();
    expect(rows[0].classList.contains('menu-open')).toBe(false);
    // The keyboard is back on the row's own More, where a click would have opened the menu.
    expect(document.activeElement).toBe(rows[0].querySelector('[aria-label="More actions"]'));
    // The Menu key opens it too, on one's own message with its Edit and Delete.
    rows[1].focus();
    expect(d.key(rows[1], 'ContextMenu').defaultPrevented).toBe(true);
    expect(items().some((t) => /Edit message/.test(t))).toBe(true);
    expect(items().some((t) => /Delete message/.test(t))).toBe(true);
    await d.tick(1);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    expect(menu()).toBeNull();
    view.destroy();
  });

  it('leave a right click with the mouse, and the edit box, to the browser', async () => {
    const { d, view, rows, menu, startInlineEdit } = await open();
    const cm = new Event('contextmenu', { bubbles: true, cancelable: true });
    rows[0].dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
    expect(startInlineEdit(rows[1])).toBe(true);
    const box = rows[1].querySelector('.msg-edit-input');
    expect(d.key(box, 'F10', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
    view.destroy();
  });
});

describe('a message’s menu, or the reaction picker opened from its row, while the message leaves the window', () => {
  const open = async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const rows = () => [...view.el.querySelectorAll('.msg')];
    return { d, view, rows };
  };

  it('stays through a redraw that keeps the message, and closes when the message is gone, the keyboard on the row now at its place', async () => {
    const { d, view, rows } = await open();
    rows()[0].querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeTruthy();
    // A teammate's reaction redraws the list: the menu stands (and acts on the row now showing the message).
    store.conv('c1').messages[1].reactions = { tada: { u3: 1 } };
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeTruthy();
    // Deleted by someone else, and gone with the poll: the menu goes, and the keyboard lands on the row now first.
    store.conv('c1').messages = store.conv('c1').messages.filter((m) => m.seq !== 1);
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(rows()[0]);
    expect(document.activeElement.dataset.seq).toBe('2');
    view.destroy();
  });

  it('leaves alone the menu of a row drawn from outside the window, as a Threads card draws a thread’s first message', async () => {
    const { dom: d } = await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    // The channel's window holds messages 40 and 41; the card's root, 7, is what the worker listed, not in the window.
    Object.assign(store.conv('c1'), { loaded: true, seq: 41, hasMore: true, messages: [message(40), message(41)] });
    const root = message(7, 'u2', { replyCount: 2 });
    const card = document.createElement('article');
    card.append(renderMessage(root, { convId: 'c1', inThread: true, isRoot: true, rootSeq: 7, parentConv: 'c1', onShowMember() {}, membersByUsername: store.membersByUsername() }));
    document.body.append(card);
    card.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeTruthy();
    // A message arriving in the channel, read elsewhere, says "messages" for it: the card's menu stands.
    store.conv('c1').messages.push(message(42));
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeTruthy();
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
  });

  it('closes the picker too, and a tombstone counts as gone', async () => {
    const { d, view, rows } = await open();
    rows()[2].querySelector('[aria-label="Add reaction"]').click();
    await d.tick(2);
    expect(document.querySelector('.emoji-picker')).toBeTruthy();
    Object.assign(store.conv('c1').messages[2], { deleted: true, text: '', replyCount: 1 });
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(1);
    expect(document.querySelector('.emoji-picker')).toBeNull();
    expect(document.activeElement).toBe(rows()[2]); // the tombstone stands at its place; the keyboard is on it
    view.destroy();
  });
});

describe('what a message’s menu opens in turn, when the message goes meanwhile', () => {
  const files = [{ id: 'f1', name: 'pic.png', size: 10, type: 'image/png' }, { id: 'f2', name: 'plan.pdf', size: 20, type: 'application/pdf' }];
  const open = async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { toast } = await import('../src/ui/toast.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1, 'u3', { attachments: files }), message(2)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    toast.mockClear();
    const row = view.el.querySelector('.msg[data-seq="1"]');
    row.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    const item = (re) => [...document.querySelectorAll('.menu .menu-item')].find((b) => re.test(b.textContent));
    const remove = () => {
      store.conv('c1').messages = store.conv('c1').messages.filter((m) => m.seq !== 1);
      store.emit('messages', { conv: 'c1', reason: 'range' });
    };
    return { d, view, toast, item, remove };
  };

  it('closes the list of reminder times', async () => {
    const { d, view, item, remove } = await open();
    item(/Remind me about this/).click();
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"] .menu-label')?.textContent).toBe('Remind me');
    remove();
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeNull();
    view.destroy();
  });

  it('sets no reminder for a custom time picked after the message went, and says so', async () => {
    const { d, view, toast, item, remove } = await open();
    const remind = vi.spyOn(store, 'remind').mockResolvedValue({});
    item(/Remind me about this/).click();
    await d.tick(1);
    item(/Custom time/).click();
    await d.tick(1);
    const input = document.querySelector('input[type="datetime-local"]');
    expect(input).toBeTruthy();
    remove();
    await d.tick(1);
    const at = new Date(Date.now() + 3600_000);
    const pad = (n) => String(n).padStart(2, '0');
    input.value = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
    input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(2);
    expect(remind).not.toHaveBeenCalled();
    expect(toast.mock.calls.some((c) => /no longer here/.test(c[0]))).toBe(true);
    view.destroy();
  });

  it('forwards nothing for a message that went while the Forward dialog stood, and closes the dialog on the word', async () => {
    const { d, view, toast, item, remove } = await open();
    const { openModal } = await import('../src/ui/modal.js');
    const send = vi.spyOn(store, 'send').mockResolvedValue({ seq: 9 });
    item(/Forward message/).click();
    await d.tick(1);
    const modal = openModal.mock.results.at(-1).value;
    [...document.querySelectorAll('.pick-item')].find((b) => b.textContent.includes('random')).click();
    remove();
    await d.tick(1);
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Forward').click();
    await d.tick(2);
    expect(send).not.toHaveBeenCalled();
    expect(toast.mock.calls.some((c) => /no longer here; nothing was forwarded/.test(c[0]))).toBe(true);
    expect(modal.close).toHaveBeenCalled();
    view.destroy();
  });

  it('closes the list of files to bookmark', async () => {
    const { d, view, item, remove } = await open();
    item(/Bookmark a file in channel/).click();
    await d.tick(1);
    expect(item(/plan\.pdf/)).toBeTruthy();
    remove();
    await d.tick(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeNull();
    view.destroy();
  });
});

describe('a long file name on a chip or a card', () => {
  const long = 'quarterly-report-final-v2-reviewed-by-legal-2026-09-07.pdf';

  it('is cut in the middle, the end with the extension kept, and whole where there is room', async () => {
    await boot();
    const { fileLabel, fileLabelShort } = await import('../src/ui/filename.js');
    expect(fileLabelShort(long)).toBe('quarterly-report-fi…26-09-07.pdf');
    expect([...fileLabelShort(long)]).toHaveLength(32);
    expect(fileLabelShort('plan.pdf')).toBe('plan.pdf');
    expect(fileLabelShort('a'.repeat(32) + '.txt', 36)).toBe('a'.repeat(32) + '.txt');
    // A direction override is taken out first, as fileLabel takes it out; a cut never splits an emoji.
    expect(fileLabelShort('invoice‮fdp.exe')).toBe('invoicefdp.exe');
    expect(fileLabelShort('🎉'.repeat(40) + '.png', 20, 8)).toBe('🎉'.repeat(11) + '…' + '🎉'.repeat(4) + '.png');
    expect(fileLabel(long)).toBe(long);
  });

  it('shows the cut on the composer’s chip and the message’s file card, the whole name in their titles and accessible names', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise(() => {}));
    const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
    document.body.append(box.el);
    const input = box.el.querySelector('input[type="file"]');
    input.files = [{ name: long, size: 1234, type: 'application/pdf' }];
    input.dispatchEvent(new Event('change'));
    await d.tick(1);
    const chip = box.el.querySelector('.chip');
    expect(chip.querySelector('.chip-name').textContent).toBe('quarterly-report-fi…26-09-07.pdf');
    expect(chip.getAttribute('title')).toBe(long);
    expect(chip.querySelector('button').getAttribute('aria-label')).toBe(`Remove ${long}`);
    box.destroy();
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u3', { attachments: [{ id: 'f1', name: long, size: 20, type: 'application/pdf' }] })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const card = view.el.querySelector('.attachment');
    expect(card.querySelector('strong').textContent).toBe('quarterly-report-fi…26-09-07.pdf');
    expect(card.getAttribute('aria-label')).toBe(`Download ${long}`);
    expect(card.getAttribute('title')).toBe(long);
    view.destroy();
  });
});

describe('the message box’s height when its column changes width', () => {
  it('is measured again as the box resizes, and the watch ends with the box', async () => {
    const { dom: d } = await boot();
    const observers = [];
    class FakeResizeObserver {
      constructor(cb) { this.cb = cb; this.observed = []; this.disconnected = false; observers.push(this); }
      observe(node) { this.observed.push(node); }
      unobserve() {}
      disconnect() { this.disconnected = true; }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      const { createComposer } = await import('../src/ui/composer.js');
      const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
      document.body.append(box.el);
      await d.tick(1);
      const ro = observers.find((o) => o.observed.includes(box.el.querySelector('.composer')));
      expect(ro).toBeTruthy();
      // The column narrows: the words now take 96px of height in the box.
      Object.defineProperty(box.textarea, 'scrollHeight', { value: 96, configurable: true });
      ro.cb([]);
      expect(box.textarea.style.height).toBe('96px');
      // Wider again: three lines' worth.
      Object.defineProperty(box.textarea, 'scrollHeight', { value: 66, configurable: true });
      ro.cb([]);
      expect(box.textarea.style.height).toBe('66px');
      box.destroy();
      expect(ro.disconnected).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('a long press on a message with a finger', () => {
  it('opens no menu while the press is selecting words, and opens it otherwise', async () => {
    const { dom: d } = await boot({ coarse: true, hover: false });
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const row = view.el.querySelector('.msg');
    const press = () => {
      const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperties(ev, { pointerType: { value: 'touch' }, clientX: { value: 40 }, clientY: { value: 40 } });
      row.dispatchEvent(ev);
    };
    const selecting = window.getSelection;
    // The press is selecting the row's own words: the selection lies in the row.
    window.getSelection = () => ({ toString: () => 'm1', anchorNode: row.querySelector('.msg-text'), focusNode: row.querySelector('.msg-text'), rangeCount: 0 });
    press();
    await d.tick(700);
    expect(document.querySelector('.menu[role="menu"]')).toBeNull();
    window.getSelection = selecting;
    press();
    await d.tick(700);
    expect(document.querySelector('.menu[role="menu"]')).toBeTruthy();
    view.destroy();
  });
});

describe('Copy link and Copy text in a browser without the clipboard API', () => {
  it('copy the older way and say so, or say they could not, rather than doing nothing', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { toast } = await import('../src/ui/toast.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u2', { text: 'hello **there**' })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    navigator.clipboard = undefined;
    const copied = [];
    document.execCommand = vi.fn(() => { copied.push(document.activeElement?.value); return true; });
    const row = view.el.querySelector('.msg');
    row.focus();
    toast.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }));
    await d.tick(2);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copied[0]).toMatch(/#\/ws\/.*\/c\/c1\/m\/1$/);
    expect(toast.mock.calls.map((c) => c[0])).toContain('Link copied');
    // The keyboard is back where it was.
    expect(document.activeElement).toBe(row);
    // Copy text takes the words as typed.
    row.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => /Copy text/.test(b.textContent)).click();
    await d.tick(2);
    expect(copied[1]).toBe('hello **there**');
    expect(toast.mock.calls.map((c) => c[0])).toContain('Copied');
    // And when even the older way is refused, the reader hears so.
    document.execCommand = vi.fn(() => false);
    toast.mockClear();
    row.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true }));
    await d.tick(2);
    expect(toast.mock.calls.some((c) => c[0] === 'Could not copy')).toBe(true);
    view.destroy();
  });
});

describe('the "New" line when the reader posts', () => {
  it('goes with the reader’s own message, and stays through a queued message merely sent again', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    store.me.reads.c1 = 1;
    store.act.c.c1 = { s: 3 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const line = () => view.el.querySelector('.new-divider');
    expect(line()?.nextElementSibling?.dataset.seq).toBe('2');
    // A queued message of the reader's sent again says "local" with nothing added: the line stands.
    store.emit('messages', { conv: 'c1', reason: 'local' });
    await d.tick(2);
    expect(line()?.nextElementSibling?.dataset.seq).toBe('2');
    // The reader posts: their message goes to the bottom, and the line goes.
    const temp = { tempId: 't1', user: 'u-me', text: 'on it', ts: Date.now(), kind: 'msg', pending: true, attachments: [], mentions: [], reactions: {} };
    store.conv('c1').messages.push(temp);
    store.emit('messages', { conv: 'c1', reason: 'local', added: [temp] });
    await d.tick(2);
    expect(line()).toBeNull();
    expect(view.el.querySelectorAll('.msg')).toHaveLength(4);
    view.destroy();
  });
});

describe('the tooltip on a reaction with many people behind it', () => {
  it('names three and counts the rest, while a screen reader still hears them all', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    for (let i = 4; i <= 13; i++) store.ws.members[`u${i}`] = { role: 'member', name: `Person ${i}`, username: `p${i}`, color: 1 };
    const twelve = Object.fromEntries(['u2', 'u3', ...Array.from({ length: 10 }, (_, i) => `u${i + 4}`)].map((u) => [u, 1]));
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1, 'u2', { reactions: { tada: twelve } }), message(2, 'u2', { reactions: { tada: { u2: 1, u3: 1, u4: 1, u5: 1 } } })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const [many, four] = [...view.el.querySelectorAll('.reaction:not(.reaction-add)')];
    expect(many.getAttribute('title')).toBe('tada: Ana Rocha, Ben Ito, Person 4 and 9 others');
    // The name says how many first (pass 27), then every one of them.
    expect(many.getAttribute('aria-label')).toBe(`tada, 12 reactions: Ana Rocha, Ben Ito, ${Array.from({ length: 10 }, (_, i) => `Person ${i + 4}`).join(', ')}`);
    // Four names fit; they are all told.
    expect(four.getAttribute('title')).toBe('tada: Ana Rocha, Ben Ito, Person 4, Person 5');
    view.destroy();
  });
});

describe('Clear, under the status in the settings', () => {
  /** The settings dialog open on its Status part, with "🎯 Focusing" set. */
  const openWithStatus = async () => {
    const { dom: d } = await boot();
    store.ws.members['u-me'].status = { emoji: '🎯', text: 'Focusing', until: null };
    const { settingsDialog } = await import('../src/ui/dialogs.js');
    const { toast } = await import('../src/ui/toast.js');
    settingsDialog({ section: 'status' });
    await d.tick(2);
    const input = document.querySelector('.status-row input');
    const emoji = document.querySelector('.status-emoji-btn');
    const clear = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Clear' && b.classList.contains('btn'));
    expect(input.value).toBe('Focusing');
    expect(emoji.textContent).toBe('🎯');
    expect(clear.hidden).toBe(false);
    return { d, input, emoji, clear, toast };
  };

  it('keeps the words and the emoji in the box when the status could not be cleared, since it still stands', async () => {
    const { d, input, emoji, clear, toast } = await openWithStatus();
    vi.spyOn(store, 'updateStatus').mockRejectedValue(new Error('You are offline'));
    clear.focus();
    clear.click();
    await d.tick(3);
    expect(toast.mock.calls.some((c) => /offline/.test(c[0]))).toBe(true);
    expect(input.value).toBe('Focusing');
    expect(emoji.textContent).toBe('🎯');
    expect(emoji.getAttribute('aria-label')).toBe('Status emoji 🎯. Change');
    expect(clear.hidden).toBe(false);
    expect(document.activeElement).toBe(clear);
  });

  it('empties the box once the status is cleared, and says so on the emoji button too', async () => {
    const { d, input, emoji, clear } = await openWithStatus();
    const update = vi.spyOn(store, 'updateStatus').mockResolvedValue(null);
    clear.focus();
    clear.click();
    clear.click(); // a double click clears once
    await d.tick(3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(null);
    expect(input.value).toBe('');
    expect(emoji.textContent).toBe('');
    expect(emoji.getAttribute('aria-label')).toBe('Pick a status emoji');
    expect(clear.hidden).toBe(true);
    // Clear went with the keyboard on it: the status box takes it, rather than the page.
    expect(document.activeElement).toBe(input);
  });

  it('starts "Clear after" over with the status, the cleared status’s own time no longer on offer', async () => {
    const { dom: d } = await boot();
    store.ws.members['u-me'].status = { emoji: '🎯', text: 'Focusing', until: Date.now() + 3600_000 };
    const { settingsDialog } = await import('../src/ui/dialogs.js');
    settingsDialog({ section: 'status' });
    await d.tick(2);
    const select = document.querySelector('select[aria-label="Clear status after"]');
    const keep = () => [...select.querySelectorAll('option')].find((o) => o.value === 'keep');
    expect(select.value).toBe('keep');
    expect(keep().textContent).toMatch(/^Until /);
    vi.spyOn(store, 'updateStatus').mockResolvedValue(null);
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Clear' && b.classList.contains('btn')).click();
    await d.tick(3);
    expect(select.value).toBe('never');
    expect(keep()).toBeUndefined();
  });
});
