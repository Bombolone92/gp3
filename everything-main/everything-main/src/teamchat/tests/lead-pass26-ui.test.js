/**
 * Twenty-sixth review pass, the Files view and the Integrations dialog,
 * driven in node through tests/helpers/dom.js (a small DOM: elements,
 * selectors, bubbling events, focus; no CSS). Every test boots a fresh DOM
 * and a fresh module registry, as tests/ui-shell-pass21.test.js does.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    return { el: node, destroy() {}, renderHeader() {}, tab: () => 'messages', setTab() {}, jumpTo() {} };
  },
}));
vi.mock('../src/ui/huddle.js', () => ({
  mountHuddleDock() {},
  joinHuddleFlow() {},
  huddleButton() { return document.createElement('span'); },
  createHuddleBar() { return { el: document.createElement('div'), destroy() {} }; },
}));
vi.mock('../src/ui/panel.js', () => ({
  renderThreadPanel: () => ({ destroy() {}, jumpTo() {} }),
}));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

/** A fresh DOM and fresh modules with a faked Puter and a small workspace the store opens when asked (see tests/ui-shell-pass21.test.js). */
async function bootApp({ hash = '', width = 1280, routes = {}, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ hash, width, ...env });
  vi.resetModules();
  const calls = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  const { store } = await import('../src/lib/store.js');
  const open = () => {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = {
      id: 'abc123def0', name: 'Globex',
      channels: {
        c1: { id: 'c1', name: 'general', def: true },
        c2: { id: 'c2', name: 'ops' },
        c3: { id: 'c3', name: 'random', count: 2 },
      },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan', color: 2 },
      },
    };
    store.me = {
      role: 'member', channels: ['c1', 'c2'],
      dms: { dm_d: { members: ['u-me', 'u-dan'], createdAt: 3 } },
      reads: {}, mentions: {}, notify: {}, threads: {},
    };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.workspaces = [{ id: REF, name: 'Globex' }];
  };
  store.openWorkspace = async () => { open(); store.emit('workspace'); };
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, open, calls, dom };
}

describe('who shared a file or a link, in the Files view', () => {
  const hook = { conv: 'c1', seq: 7, ts: 7000, user: 'hook_abc', bot: { name: 'Deploys', color: 3 }, text: 'Build 42 passed, see https://ci.example.com/42', attachments: [{ id: 'f1', name: 'log.txt', size: 12, type: 'text/plain' }] };
  const dan = { conv: 'c2', seq: 3, ts: 3000, user: 'u-dan', text: 'the plan', attachments: [{ id: 'f2', name: 'plan.pdf', size: 900, type: 'application/pdf' }] };

  it('names an integration as the message does, on its own colour, rather than "App" in grey', async () => {
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: { '/search': (q) => json({ results: q.get('has') === 'file' ? [hook, dan] : [hook], indexed: true }) },
    });
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await ctx.dom.tick(5);
    const rows = [...page.el.querySelectorAll('.files-row')];
    expect(rows.length).toBe(3);
    const who = (row) => ({ name: row.querySelector('.files-meta > span').textContent, color: row.querySelector('.files-meta .avatar').dataset.color });
    // The webhook's file and its link, then Dan's file (newest first).
    expect(who(rows[0])).toEqual({ name: 'Deploys', color: '3' });
    expect(who(rows[1])).toEqual({ name: 'Deploys', color: '3' });
    expect(who(rows[2])).toEqual({ name: 'Dan Ito', color: '2' });
    page.destroy();
  });

  it('hands the viewer the same author for an integration\'s picture', async () => {
    const shot = { ...hook, seq: 8, ts: 8000, text: '', attachments: [{ id: 'f3', name: 'shot.png', size: 100, type: 'image/png' }] };
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: { '/search': (q) => json({ results: q.get('has') === 'file' ? [shot] : [], indexed: true }) },
    });
    ctx.open();
    const viewer = await import('../src/ui/mediaviewer.js');
    const opened = vi.spyOn(viewer, 'openMediaViewer').mockImplementation(() => null);
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await ctx.dom.tick(5);
    page.el.querySelector('.files-row .files-main').click();
    expect(opened).toHaveBeenCalledTimes(1);
    const { items, index } = opened.mock.calls[0][0];
    expect(index).toBe(0);
    expect(items[0].author.name).toBe('Deploys');
    expect(items[0].author.color).toBe(3);
    expect(items[0].author.bot).toBe(true);
    page.destroy();
  });
});

describe('a conversation\'s Files & links tab and the replies in its threads', () => {
  /** The tab over #general, with a root in the window whose thread has one reply; `reads` counts the index reads scoped to it. */
  async function tab({ reply = 5000 } = {}) {
    let reads = 0;
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/c/c1/files`,
      routes: { '/search': (q) => { if (q.get('in') === 'c1') reads++; return json({ results: [], indexed: true }); } },
    });
    ctx.open();
    const c = ctx.store.conv('c1');
    c.loaded = true;
    c.messages = [{ seq: 5, user: 'u-dan', text: 'root', ts: 1000, kind: 'msg', attachments: [], reactions: {}, replyCount: 1, lastReplyAt: reply }];
    const { createFilesView } = await import('../src/ui/filesview.js');
    const view = createFilesView('c1');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    // The first load: files and links, one read each.
    expect(reads).toBe(2);
    reads = 0;
    return { ...ctx, view, c, reads: () => reads };
  }

  it('reads the list again when a reply of the reader\'s own lands in one of the threads, as it does for a message', async () => {
    const t = await tab();
    t.store.emit('messages', { conv: 'c1_t5', reason: 'sent', message: { seq: 1 } });
    await t.dom.tick(5);
    expect(t.reads()).toBe(0); // coalesced, as the rail's Files page coalesces
    await t.dom.tick(1700);
    expect(t.reads()).toBe(2);
    t.view.destroy();
  });

  it('reads it again when someone else\'s reply moves a root\'s stamp in a re-read window, and not when a root is merely read in', async () => {
    const t = await tab();
    // The window read in again with nothing new about the thread: no read.
    t.store.emit('messages', { conv: 'c1', reason: 'range' });
    await t.dom.tick(1700);
    expect(t.reads()).toBe(0);
    // A root first read into the window (an older page) says nothing new either.
    t.c.messages.unshift({ seq: 2, user: 'u-dan', text: 'older root', ts: 500, kind: 'msg', attachments: [], reactions: {}, replyCount: 3, lastReplyAt: 9000 });
    t.store.emit('messages', { conv: 'c1', reason: 'older' });
    await t.dom.tick(1700);
    expect(t.reads()).toBe(0);
    // Someone replied: the re-read window carries the root's new stamp.
    t.c.messages[1].replyCount = 2;
    t.c.messages[1].lastReplyAt = 12000;
    t.store.emit('messages', { conv: 'c1', reason: 'range' });
    await t.dom.tick(1700);
    expect(t.reads()).toBe(2);
    t.view.destroy();
  }, 10_000);

  it('leaves a reply in another conversation\'s thread alone', async () => {
    const t = await tab();
    t.store.emit('messages', { conv: 'c2_t9', reason: 'sent', message: { seq: 1 } });
    await t.dom.tick(1700);
    expect(t.reads()).toBe(0);
    t.view.destroy();
  });
});

describe('the rail\'s Files page and messages landing where no window stands', () => {
  /** The page, with `reads` counting the index reads after the first load. */
  async function page() {
    let reads = 0;
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: { '/search': () => { reads++; return json({ results: [], indexed: true }); } },
    });
    ctx.open();
    ctx.store.act.c = { c1: { s: 3 }, c2: { s: 7 } };
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const view = createFilesPage();
    document.body.append(view.el);
    await ctx.dom.tick(5);
    expect(reads).toBe(2);
    reads = 0;
    return { ...ctx, view, reads: () => reads };
  }

  it('reads the list again when a conversation\'s counter moves on a poll, though no window stands for it here', async () => {
    const t = await page();
    // The poll brought the activity document: #ops has a fourth message, never opened in this tab.
    t.store.act.c.c2 = { s: 8 };
    t.store.emit('activity');
    await t.dom.tick(5);
    expect(t.reads()).toBe(0); // coalesced
    await t.dom.tick(1700);
    expect(t.reads()).toBe(2);
    t.view.destroy();
  });

  it('does not read it again for activity that moved no counter (presence, unread marks), nor after it is gone', async () => {
    const t = await page();
    t.store.emit('activity');
    await t.dom.tick(1700);
    expect(t.reads()).toBe(0);
    t.view.destroy();
    t.store.act.c.c1 = { s: 9 };
    t.store.emit('activity');
    await t.dom.tick(1700);
    expect(t.reads()).toBe(0);
  });
});

describe('the Integrations dialog', () => {
  /** The dialog open for an admin, with the modal layer and the toast faked (as tests/ui-conv-pass23.test.js has them). */
  async function openAsAdmin({ integrations = { webhooks: [], bots: [] }, openConv = null } = {}) {
    vi.doMock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
    vi.doMock('../src/ui/modal.js', () => ({
      confirmDialog: vi.fn(async () => true),
      closeAllModals: vi.fn(),
      openModal: vi.fn(({ content, onClose }) => {
        document.body.append(content);
        const close = vi.fn(() => { content.remove(); onClose?.(); });
        return { close, panel: content, root: content };
      }),
    }));
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/webhooks': () => json(integrations) } });
    ctx.open();
    ctx.store.ws.members['u-me'].role = 'admin';
    ctx.store.me.role = 'admin';
    ctx.store.ws.channels.c4 = { id: 'c4', name: 'old-builds', archived: true };
    ctx.store.ws.channels.c0 = { id: 'c0', name: 'alpha-private', private: true };
    ctx.store.me.channels.push('c0', 'c4');
    ctx.store.openConv = openConv;
    const { integrationsDialog } = await import('../src/ui/dialogs.js');
    integrationsDialog();
    await ctx.dom.tick(5);
    return ctx;
  }

  afterEach(() => {
    vi.doUnmock('../src/ui/toast.js');
    vi.doUnmock('../src/ui/modal.js');
  });

  it('says which of an integration\'s channels are archived, where every post is refused', async () => {
    await openAsAdmin({
      integrations: {
        webhooks: [{ id: 'h1', name: 'Builds', ch: 'c4', color: 2, lastUsed: null }, { id: 'h2', name: 'Alerts', ch: 'c1', color: 3, lastUsed: null }],
        bots: [{ id: 'b1', name: 'Reader', channels: ['c4', 'c2'], scopes: ['read'], lastUsed: null }],
      },
    });
    const subs = [...document.querySelectorAll('.details-row')].map((r) => r.querySelector('.details-text span').textContent);
    expect(subs).toEqual([
      '#old-builds (archived) · never used',
      '#general · never used',
      '#old-builds (archived), #ops · never used · read',
    ]);
  });

  it('lists a bot\'s own archived channel when editing it, marked, so that it can be taken off; other archived channels are not offered', async () => {
    const ctx = await openAsAdmin({
      integrations: { webhooks: [], bots: [{ id: 'b1', name: 'Reader', channels: ['c4', 'c2'], scopes: ['read'], lastUsed: null }] },
    });
    ctx.store.ws.channels.c5 = { id: 'c5', name: 'zzz-archived-too', archived: true };
    document.querySelector('button[aria-label="Manage Reader"]').click();
    await ctx.dom.tick(2);
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Channels and scopes')).click();
    await ctx.dom.tick(2);
    const items = [...document.querySelectorAll('.pick-list[aria-label="Channels the bot may use"] .pick-item')];
    expect(items.map((n) => n.querySelector('strong').textContent)).toEqual(['alpha-private', 'general', 'old-buildsArchived', 'ops', 'random']);
    expect(items.map((n) => n.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'true', 'false']);
    expect(items[2].querySelector('.pill').textContent).toBe('Archived');
    expect(items.some((n) => n.textContent.includes('zzz-archived-too'))).toBe(false);
    // Taken off and saved: the list sent no longer names it.
    const { api } = await import('../src/lib/api.js');
    const update = vi.spyOn(api, 'updateBot').mockResolvedValue({ ok: true });
    vi.spyOn(ctx.store, 'refreshAfterChange').mockResolvedValue();
    items[2].click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    await ctx.dom.tick(3);
    expect(update).toHaveBeenCalledWith(REF, 'b1', { channels: ['c2'], scopes: ['read'] });
  });

  it('offers a new webhook the channel the admin has open, else the default channel, rather than whichever sorts first', async () => {
    const ctx = await openAsAdmin({ openConv: 'c2' });
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New webhook')).click();
    await ctx.dom.tick(1);
    const select = document.querySelector('select[aria-label="Posts to channel"]');
    // By name, the private channel first; archived ones not offered at all.
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['#alpha-private', '#general', '#ops', '#random']);
    expect(select.value).toBe('c2');
    select.closest('form').remove();
    // A direct message open: the default channel.
    ctx.store.openConv = 'dm_d';
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New webhook')).click();
    await ctx.dom.tick(1);
    expect(document.querySelector('select[aria-label="Posts to channel"]').value).toBe('c1');
  });
});
