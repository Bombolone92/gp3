/**
 * Twenty-fifth review pass, the shell's router and panels: driven in node
 * through tests/helpers/dom.js with the shell mounted whole, as
 * tests/ui-shell-pass24-shell.test.js has it (the conversation column, the
 * huddle dock and the thread panel stand in as small boxes). Every test boots
 * a fresh DOM and a fresh module registry. The Threads view's cards and the
 * lists are in tests/ui-shell-pass25.test.js, whose navigation is mocked.
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
  vi.doUnmock('../src/ui/message.js');
});

/** A fresh DOM and fresh modules with a faked Puter and a small workspace the store opens when asked (see tests/ui-shell-pass24-shell.test.js). */
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

/**
 * A message row's hover bar as the stylesheet has it (see .msg-actions):
 * drawn only while the row is under the pointer or holds the keyboard, so a
 * button of it cannot be focused from outside the row. The DOM here applies
 * no CSS; the bar is hidden by attribute on the same terms instead.
 */
function hoverBarsAsDrawn() {
  vi.doMock('../src/ui/message.js', async (importOriginal) => {
    const mod = await importOriginal();
    return {
      ...mod,
      renderMessage: (msg, ctx) => {
        const row = mod.renderMessage(msg, ctx);
        const bar = row.querySelector('.msg-actions');
        if (bar) {
          const draw = () => { bar.hidden = !(row.contains(document.activeElement) || row.classList.contains('menu-open')); };
          row.addEventListener('focusin', draw);
          row.addEventListener('focusout', () => queueMicrotask(draw));
          draw();
        }
        return row;
      },
    };
  });
}

describe('the shortcut for a pane already showing beside an open conversation (Cmd+Shift+D over the Direct messages pane)', () => {
  const routes = { '/messages': () => json({ messages: [], seq: 0 }) };

  it('keeps the conversation, as the rail\'s own item does, and puts the keyboard on its row in the pane', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, routes });
    const { buildHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const box = app.querySelector('#main textarea');
    expect(box).toBeTruthy();
    box.focus();
    expect(document.activeElement).toBe(box);
    key(document, { key: 'D', metaKey: true, shiftKey: true });
    await ctx.dom.tick(10);
    // The same route: the conversation stands, and no "Pick a conversation" has taken its place.
    expect(location.hash).toBe(buildHash({ ws: REF, conv: 'dm_d', view: 'dms' }));
    expect(app.querySelector('#main')?.dataset.conv).toBe('dm_d');
    const at = document.activeElement;
    expect(at.matches('a.pane-row'), at.outerHTML.slice(0, 80)).toBe(true);
    expect(at.getAttribute('href')).toBe(buildHash({ ws: REF, conv: 'dm_d', view: 'dms' }));
  });

  it('on a phone, where the pane is a screen of its own behind the conversation, still opens the pane', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, width: 600, routes });
    const { buildHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    app.querySelector('#main textarea').focus();
    key(document, { key: 'D', metaKey: true, shiftKey: true });
    await ctx.dom.tick(10);
    expect(location.hash).toBe(buildHash({ ws: REF, view: 'dms' }));
  });

  it('still opens the pane when another is showing, or none', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/activity/c/c1`, routes });
    const { buildHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    app.querySelector('#main textarea').focus();
    key(document, { key: 'D', metaKey: true, shiftKey: true });
    await ctx.dom.tick(10);
    expect(location.hash).toBe(buildHash({ ws: REF, view: 'dms' }));
  });
});

describe('a shortcut pressed while a menu stands open (a sidebar row\'s, from its kebab)', () => {
  const routes = { '/messages': () => json({ messages: [], seq: 0 }) };

  /** The shell over #general, with the #ops row's menu open from its kebab. */
  async function withRowMenu() {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes });
    const app = await mountedShell(ctx);
    const kebab = [...app.querySelectorAll('.sidebar-home .side-kebab')].find((k) => k.getAttribute('aria-label') === 'Options for #ops');
    expect(kebab).toBeTruthy();
    kebab.click();
    await ctx.dom.tick(5);
    const menu = document.querySelector('.menu[role="menu"]');
    expect(menu).toBeTruthy();
    expect(menu.contains(document.activeElement)).toBe(true);
    return { ctx, app, menu };
  }

  it('Cmd+/ takes the menu down as it opens the shortcuts list, rather than leaving it standing over the page', async () => {
    const { ctx, app, menu } = await withRowMenu();
    key(document, { key: '/', metaKey: true });
    await ctx.dom.tick(5);
    expect(app.querySelector('.panel').hidden).toBe(false);
    expect(menu.isConnected).toBe(false);
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('Shift+Cmd+K takes it down as it opens New message, rather than leaving it drawn over the dialog', async () => {
    const { ctx, menu } = await withRowMenu();
    key(document, { key: 'K', metaKey: true, shiftKey: true });
    await ctx.dom.tick(5);
    expect(document.querySelector('.modal-root')).toBeTruthy();
    expect(menu.isConnected).toBe(false);
    expect(document.querySelector('.menu')).toBeNull();
    // The keyboard is in the dialog, not back on the kebab behind it.
    expect(document.querySelector('.modal-root').contains(document.activeElement)).toBe(true);
  });
});

describe('a conversation opened on a phone from a row of the list that then hides under it', () => {
  const routes = { '/messages': () => json({ messages: [], seq: 0 }) };

  it('sidebar list: the keyboard goes into the conversation\'s column, not left on the hidden row', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}`, width: 600, routes });
    const { parseHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const shell = app.querySelector('.shell');
    expect(shell.classList.contains('show-sidebar')).toBe(true);
    const row = [...app.querySelectorAll('.sidebar-home a.side-item')].find((a) => parseHash(a.getAttribute('href')).conv === 'c2');
    row.focus();
    expect(document.activeElement).toBe(row);
    row.click();
    await ctx.dom.tick(10);
    expect(parseHash(location.hash).conv).toBe('c2');
    expect(shell.classList.contains('show-sidebar')).toBe(false);
    const main = app.querySelector('#main');
    expect(main?.dataset.conv).toBe('c2');
    expect(main.contains(document.activeElement), document.activeElement.outerHTML.slice(0, 80)).toBe(true);
  });

  it('Direct messages pane: the same, from a row of the pane', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, width: 600, routes });
    const { parseHash, buildHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const shell = app.querySelector('.shell');
    expect(shell.classList.contains('show-sidebar')).toBe(true);
    const row = app.querySelector(`.sidebar-pane a.pane-row[href="${buildHash({ ws: REF, conv: 'dm_d', view: 'dms' })}"]`);
    row.focus();
    row.click();
    await ctx.dom.tick(10);
    expect(parseHash(location.hash).conv).toBe('dm_d');
    expect(shell.classList.contains('show-sidebar')).toBe(false);
    const main = app.querySelector('#main');
    expect(main?.dataset.conv).toBe('dm_d');
    expect(main.contains(document.activeElement)).toBe(true);
    // And the browser's Back brings the pane back as the screen, the keyboard on that row.
    history.back();
    await ctx.dom.tick(10);
    expect(shell.classList.contains('show-sidebar')).toBe(true);
    expect(document.activeElement.matches('a.pane-row')).toBe(true);
    expect(parseHash(document.activeElement.getAttribute('href')).conv).toBe('dm_d');
  });

  it('on a desk the row keeps the keyboard, as before', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, width: 1280, routes });
    const { parseHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const row = [...app.querySelectorAll('.sidebar-home a.side-item')].find((a) => parseHash(a.getAttribute('href')).conv === 'c2');
    row.focus();
    row.click();
    await ctx.dom.tick(10);
    expect(parseHash(location.hash).conv).toBe('c2');
    expect(document.activeElement.matches('a.side-item')).toBe(true);
    expect(parseHash(document.activeElement.getAttribute('href')).conv).toBe('c2');
  });
});

describe('the phone layout and the window turned (a matchMedia change) with a pane open beside a conversation', () => {
  const routes = { '/messages': () => json({ messages: [], seq: 0 }) };

  it('shows the conversation alone under 720px and the pane beside it again above, the route unchanged', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, width: 1280, routes });
    const app = await mountedShell(ctx);
    const shell = app.querySelector('.shell');
    const hash = location.hash;
    expect(app.querySelector('.sidebar-pane').hidden).toBe(false);
    ctx.dom.setWidth(600);
    await ctx.dom.tick(10);
    expect(location.hash).toBe(hash);
    expect(shell.classList.contains('show-sidebar')).toBe(false);
    expect(app.querySelector('#main')?.dataset.conv).toBe('dm_d');
    expect(app.querySelector('.sidebar-pane').hidden).toBe(false);
    ctx.dom.setWidth(1280);
    await ctx.dom.tick(10);
    expect(location.hash).toBe(hash);
    expect(app.querySelector('#main')?.dataset.conv).toBe('dm_d');
    expect(app.querySelector('.sidebar-pane').hidden).toBe(false);
  });

  it('a pane alone becomes the screen under 720px, and the "Pick a conversation" column comes back above', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/later`, width: 1280, routes });
    const app = await mountedShell(ctx);
    const shell = app.querySelector('.shell');
    expect(shell.classList.contains('show-sidebar')).toBe(false);
    ctx.dom.setWidth(600);
    await ctx.dom.tick(10);
    expect(shell.classList.contains('show-sidebar')).toBe(true);
    expect(app.querySelector('.sidebar-pane').hidden).toBe(false);
    ctx.dom.setWidth(1280);
    await ctx.dom.tick(10);
    expect(shell.classList.contains('show-sidebar')).toBe(false);
    expect(app.querySelector('#main .empty h1')?.textContent).toBe('Pick a saved item');
  });
});

describe('an invite link followed on a phone while the channel list is the screen (pasted into the address bar, which changes the fragment alone)', () => {
  it('shows the join\'s wait in place of the list, rather than nothing until the workspace opens', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}`, width: 600, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const app = await mountedShell(ctx);
    const shell = app.querySelector('.shell');
    expect(shell.classList.contains('show-sidebar')).toBe(true);
    // The worker takes its time over the invite.
    ctx.store.join = () => new Promise(() => {});
    location.hash = '#/join/teamchat-test/ABCD-EFGH-IJKL';
    await ctx.dom.tick(10);
    expect(shell.classList.contains('show-sidebar')).toBe(false);
    expect(app.querySelector('#main [aria-busy="true"]')).toBeTruthy();
  });
});

describe('the tab\'s title when the reader switches to a workspace that cannot be loaded', () => {
  const OTHER = 'ffffffffff@teamchat-test';

  it('drops the count of the workspace left behind as the switch begins, and carries none over the failure page', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const app = await mountedShell(ctx);
    const { store } = ctx;
    // Three mentions waiting in #general: the title counts them.
    store.me.mentions = { c1: 3 };
    store.emit('activity');
    expect(document.title).toBe('(3) Globex | Teamchat');
    // The other workspace's server does not answer. The store lets the open
    // workspace go the moment the switch begins, as the real one does, and
    // says nothing of the failure but by the rejection.
    const failing = new Error('Could not reach the workspace server');
    store.openWorkspace = async (id) => {
      store.wsId = id;
      store.ws = null;
      store.me = null;
      if (id === OTHER) throw failing;
      ctx.open();
      store.emit('workspace');
    };
    location.hash = `#/ws/${encodeURIComponent(OTHER)}/c/c9`;
    await ctx.dom.tick(10);
    expect(app.querySelector('#main h1')?.textContent).toBe('Could not load the workspace');
    expect(document.title).toBe('Teamchat');
    // Back to the first workspace: its count comes back with it.
    history.back();
    await ctx.dom.tick(10);
    expect(app.querySelector('#main')?.dataset.conv).toBe('c1');
    store.me.mentions = { c1: 3 };
    store.emit('activity');
    expect(document.title).toBe('(3) Globex | Teamchat');
  });
});

describe('a toast\'s button pressed twice while the toast fades', () => {
  it('runs the action once (a double click on Open, Join or an Undo), and Dismiss likewise takes one press', async () => {
    dom?.uninstall();
    dom = installDom({ hash: '' });
    vi.resetModules();
    const { toast } = await import('../src/ui/toast.js');
    const onClick = vi.fn();
    toast('Forwarded to #general', { icon: 'forward', action: { label: 'Open', onClick } });
    const node = document.querySelector('.toast');
    const open = node.querySelector('.toast-action');
    expect(open).toBeTruthy();
    open.click();
    // The toast is on its way out (a fifth of a second), its button still on the page.
    expect(node.classList.contains('leaving')).toBe(true);
    expect(node.isConnected).toBe(true);
    open.click();
    open.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    // A sticky toast's Dismiss the same: one press, whatever follows it.
    const focusBack = vi.fn();
    const sticky = toast('A new version of Teamchat is ready', { duration: Infinity, dismissible: true, action: { label: 'Reload', onClick: focusBack } });
    const stickyNode = [...document.querySelectorAll('.toast')].find((n) => /new version/.test(n.textContent));
    const close = stickyNode.querySelector('.toast-close');
    close.click();
    expect(stickyNode.classList.contains('leaving')).toBe(true);
    stickyNode.querySelector('.toast-action').click();
    expect(focusBack).not.toHaveBeenCalled();
    sticky.dismiss();
    await dom.tick(450);
    expect(document.querySelector('.toast')).toBeNull();
  });
});

describe('the keyboard shortcuts panel opened from a button of a message\'s hover bar (drawn only while its row holds the keyboard) and closed from within', () => {
  const NOW = Date.now();
  const m = (seq, extra = {}) => ({ seq, user: 'u-dan', ts: NOW - (10 - seq) * 60_000, text: `message ${seq}`, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });
  const routes = {
    '/messages': () => json({ messages: [], seq: 0 }),
    '/threads': () => json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: NOW - 1000, unread: 0, root: m(1, { replyCount: 1 }) }] }),
  };

  it('hands the keyboard back to that button, through its row (which draws the bar), not to a reply box', async () => {
    hoverBarsAsDrawn();
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/threads`, routes });
    const app = await mountedShell(ctx);
    await ctx.dom.tick(20);
    const row = () => app.querySelector('#main .thread-card .msg.thread-root');
    expect(row()).toBeTruthy();
    const bar = () => row().querySelector('.msg-actions');
    expect(bar().hidden).toBe(true);
    // Tabbed onto the row, then into its bar, onto More actions.
    row().focus();
    expect(bar().hidden).toBe(false);
    const more = row().querySelector('[aria-label="More actions"]');
    more.focus();
    expect(document.activeElement).toBe(more);
    key(document, { key: '/', metaKey: true });
    await ctx.dom.tick(5);
    const panel = app.querySelector('.panel');
    expect(panel.hidden).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(true);
    // The row no longer holds the keyboard: its bar is not drawn.
    expect(bar().hidden).toBe(true);
    key(document, { key: 'Escape' });
    await ctx.dom.tick(5);
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(more);
    expect(bar().hidden).toBe(false);
  });
});
