/**
 * Twenty-fourth review pass, the shell's router: driven in node through
 * tests/helpers/dom.js with the shell mounted whole, as
 * tests/ui-shell-pass23.test.js has it (the conversation column, the huddle
 * dock and the thread panel stand in as small boxes). Every test boots a
 * fresh DOM and a fresh module registry. The Threads view's cards and the
 * lists are in tests/ui-shell-pass24.test.js, whose navigation is mocked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    const box = document.createElement('textarea');
    box.setAttribute('aria-label', 'Message');
    node.append(box);
    return { el: node, destroy() {}, renderHeader() {}, tab: () => 'messages', setTab() {}, jumpTo() {} };
  },
}));
vi.mock('../src/ui/huddle.js', () => ({
  mountHuddleDock() {},
  joinHuddleFlow: vi.fn(),
  huddleButton() { return document.createElement('span'); },
  createHuddleBar() { return { el: document.createElement('div'), destroy() {} }; },
}));
vi.mock('../src/ui/panel.js', () => ({
  renderThreadPanel: (panelEl, { onClose }) => {
    const close = document.createElement('button');
    close.className = 'icon-btn panel-close';
    close.setAttribute('aria-label', 'Close panel');
    close.addEventListener('click', onClose);
    panelEl.append(close);
    return { destroy() {}, jumpTo() {} };
  },
}));
vi.mock('../src/lib/notify.js', async (importOriginal) => ({
  ...(await importOriginal()),
  showNotification: () => {},
  playNotificationSound: () => {},
}));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

/** A fresh DOM and fresh modules with a faked Puter and a small workspace the store opens when asked (see tests/ui-shell-pass23.test.js). */
async function bootApp({ hash = '', width = 1280, routes = {}, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ hash, width, ...env });
  vi.resetModules();
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
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
      },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
        'u-eve': { role: 'member', name: 'Eve Park', username: 'eve' },
      },
    };
    store.me = {
      role: 'member', channels: ['c1', 'c2'],
      dms: { dm_d: { members: ['u-me', 'u-dan'], createdAt: 3 }, dm_e: { members: ['u-me', 'u-eve'], createdAt: 2 } },
      reads: {}, mentions: {}, notify: {}, threads: {},
    };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.workspaces = [{ id: REF, name: 'Globex' }];
  };
  store.openWorkspace = async () => { open(); store.emit('workspace'); };
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, open, dom };
}

/** The shell mounted on a fresh app root, routed to the DOM's hash. */
async function mountedShell(ctx) {
  const { mountShell } = await import('../src/ui/shell.js');
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  mountShell(app);
  await ctx.dom.tick(10);
  return app;
}

const key = (target, init) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

describe('the keyboard on a row of the Direct messages pane when Alt+Down opens the next conversation, whose row sits in a folded sidebar section', () => {
  it('goes to that row in the list that took the pane\'s place (the fold keeps the open conversation in view), not to the filter box', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    // The reader keeps Direct messages folded: only the open or unread rows of it show.
    localStorage.setItem('teamchat:collapsed', JSON.stringify({ dms: true }));
    const { buildHash, parseHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const home = app.querySelector('.sidebar-home');
    const rowFor = (conv) => [...home.querySelectorAll('a.side-item')].find((a) => parseHash(a.getAttribute('href') || '').conv === conv);
    // Folded: Eve's conversation, read, is not shown; Dan's, open, is.
    expect(rowFor('dm_e').closest('.side-row').hidden).toBe(true);
    expect(rowFor('dm_d').closest('.side-row').hidden).toBe(false);
    const pane = app.querySelector('.sidebar-pane');
    const row = pane.querySelector(`a.pane-row[href="${buildHash({ ws: REF, conv: 'dm_d', view: 'dms' })}"]`);
    row.focus();
    expect(document.activeElement).toBe(row);
    key(document, { key: 'ArrowDown', altKey: true });
    await ctx.dom.tick(10);
    const r = parseHash(location.hash);
    expect(r.name).toBe('conversation');
    expect(r.conv).toBe('dm_e');
    expect(pane.hidden).toBe(true);
    // The list is drawn again for the route, Eve's row now the open one and shown.
    expect(rowFor('dm_e').closest('.side-row').hidden).toBe(false);
    const at = document.activeElement;
    expect(at).not.toBe(document.body);
    expect(at.matches('a.side-item'), at.outerHTML.slice(0, 80)).toBe(true);
    expect(parseHash(at.getAttribute('href')).conv).toBe('dm_e');
  });
});

describe('the keyboard shortcuts panel closed from within (Escape, Cmd+/ again)', () => {
  const NOW = Date.now();
  const m = (seq, extra = {}) => ({ seq, user: 'u-dan', ts: NOW - (10 - seq) * 60_000, text: `message ${seq}`, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });
  const routes = {
    '/messages': () => json({ messages: [], seq: 0 }),
    '/threads': () => json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: NOW - 1000, unread: 0, root: m(1, { replyCount: 1 }) }] }),
  };

  it('hands the keyboard back to the control the panel was opened from (a Threads card\'s Open thread), not to a card\'s reply box', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/threads`, routes });
    const app = await mountedShell(ctx);
    await ctx.dom.tick(20);
    const open = [...app.querySelectorAll('#main button')].find((b) => b.textContent.trim() === 'Open thread');
    expect(open).toBeTruthy();
    expect(app.querySelector('#main textarea')).toBeTruthy(); // the card's reply box, which must not take the keyboard
    open.focus();
    expect(document.activeElement).toBe(open);
    key(document, { key: '/', metaKey: true });
    await ctx.dom.tick(5);
    const panel = app.querySelector('.panel');
    expect(panel.hidden).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(true);
    key(document, { key: 'Escape' });
    await ctx.dom.tick(5);
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(open);
  });

  it('still hands it to the message box over a conversation, as before, when the panel was opened from nowhere in particular', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes });
    const app = await mountedShell(ctx);
    await ctx.dom.tick(10);
    document.activeElement?.blur?.();
    expect(document.activeElement).toBe(document.body);
    key(document, { key: '/', metaKey: true });
    await ctx.dom.tick(5);
    expect(app.querySelector('.panel').contains(document.activeElement)).toBe(true);
    key(document, { key: 'Escape' });
    await ctx.dom.tick(5);
    expect(document.activeElement).toBe(app.querySelector('#main textarea'));
  });
});
