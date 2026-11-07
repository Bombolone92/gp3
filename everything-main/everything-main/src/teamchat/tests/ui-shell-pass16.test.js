/**
 * Sixteenth review pass, the shell: the app frame, the sidebar and its
 * panes, the list views and the Directory, driven in node through
 * tests/helpers/dom.js (a small DOM: elements, selectors, bubbling events,
 * focus with the focus fixup rule, a hash location that fires hashchange on
 * the next tick, matchMedia by viewport; no CSS). Every test boots a fresh
 * DOM and a fresh module registry, so the listeners the modules hang on
 * window and document never outlive their test. Puter is faked at
 * `puter.workers.exec`, as in tests/ui-shell-pass15.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.js';

// The conversation column and the huddle window are stubbed where the whole
// shell is mounted (their own tests cover them), as in the pass-15 file.
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

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

/** A fresh DOM and fresh modules; the store opens a small workspace when asked. */
async function boot({ hash = '', width = 1280, routes = {}, ...env } = {}) {
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
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
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

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

/** The shell at a route, opened and settled. */
async function shell(opts = {}) {
  const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, ...opts });
  const { mountShell } = await import('../src/ui/shell.js');
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  mountShell(app);
  await ctx.dom.tick(5);
  return { ...ctx, app };
}

describe('the Back to channels of a pane, on a phone', () => {
  const ROUTES = { '/inbox': () => json({ items: [] }), '/inbox/read': () => json({ ok: true }), '/messages': () => json({ messages: [], seq: 0 }) };

  it('hands the keyboard to the channel list that takes the pane\'s place, rather than leaving it on the page', async () => {
    const { app, dom: d } = await shell({ width: 390, hash: `#/ws/${encodeURIComponent(REF)}/activity`, routes: ROUTES });
    const sidebar = app.querySelector('.sidebar');
    const back = sidebar.querySelector('.pane-head .back');
    expect(back).not.toBeNull();
    back.focus();
    expect(document.activeElement).toBe(back);
    back.click(); // navigates to #/ws/REF: the channel list
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}`);
    expect(app.querySelector('.shell').classList.contains('show-sidebar')).toBe(true);
    expect(app.querySelector('.sidebar-home').hidden).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(sidebar.contains(document.activeElement)).toBe(true);
  });

  it('does the same from the DMs pane, and under a finger that focused Back (as Chrome on Android does) lands on no text box', async () => {
    const { app, dom: d } = await shell({ width: 390, coarse: true, hover: false, hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: ROUTES });
    const sidebar = app.querySelector('.sidebar');
    const back = sidebar.querySelector('.pane-head .back');
    back.focus();
    back.click();
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}`);
    expect(document.activeElement).not.toBe(document.body);
    expect(sidebar.contains(document.activeElement)).toBe(true);
    // Not a box under a finger, where the phone's keyboard would come up.
    expect(document.activeElement.localName).not.toBe('input');
  });

  it('leaves a touch alone: nothing had the keyboard, and nothing takes it', async () => {
    const { app, dom: d } = await shell({ width: 390, coarse: true, hover: false, hash: `#/ws/${encodeURIComponent(REF)}/later`, routes: ROUTES });
    expect(document.activeElement).toBe(document.body);
    app.querySelector('.sidebar .pane-head .back').click();
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}`);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Try again pressed from the keyboard, when the retry fails as well', () => {
  const tryAgain = (root) => [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
  const down = () => json({ code: 'error', message: 'The server is down for a moment' }, 500);

  it('keeps the keyboard on Try again in a list view (Activity), and puts it on the list when the retry lands', async () => {
    let answer = down;
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/activity`, routes: { '/inbox': () => answer(), '/inbox/read': () => json({ ok: true }) } });
    const { store, dom: d } = ctx;
    ctx.open();
    store._schedule = () => {};
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('activity');
    document.body.append(view.el);
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    tryAgain(view.el).focus();
    tryAgain(view.el).click();
    await d.tick(10);
    // Failed again: the words are back, and so is the keyboard, on the button.
    expect(tryAgain(view.el)).toBeTruthy();
    expect(document.activeElement).toBe(tryAgain(view.el));
    // The retry lands: the keyboard goes to the list, not to the page.
    answer = () => json({ items: [{ k: 'mention', c: 'c1', s: 3, by: 'u-dan', ts: 1003, message: { seq: 3, user: 'u-dan', ts: 1003, text: 'hi @me', kind: 'msg' } }] });
    tryAgain(view.el).click();
    await d.tick(10);
    expect(view.el.querySelectorAll('.view-row').length).toBe(1);
    expect(document.activeElement).toBe(view.el.querySelector('.view-row'));
    view.destroy();
  });

  it('keeps it on Try again in the Files view', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/files`, routes: { '/search': down } });
    const { dom: d } = ctx;
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const view = createFilesPage();
    document.body.append(view.el);
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    tryAgain(view.el).focus();
    tryAgain(view.el).click();
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    expect(document.activeElement).toBe(tryAgain(view.el));
    view.destroy();
  });

  it('keeps it on Try again in the search results', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/search/ops`, routes: { '/search': down } });
    const { dom: d } = ctx;
    ctx.open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('ops', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    tryAgain(view.el).focus();
    tryAgain(view.el).click();
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    expect(document.activeElement).toBe(tryAgain(view.el));
    view.destroy();
  });

  it('keeps it on Try again when a workspace cannot be loaded', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    const { ApiError } = await import('../src/lib/api.js');
    store.openWorkspace = async () => { throw new ApiError(500, 'error', 'The server is down for a moment'); };
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    expect(app.querySelector('.main h1')?.textContent).toBe('Could not load the workspace');
    tryAgain(app).focus();
    tryAgain(app).click();
    await d.tick(10);
    expect(app.querySelector('.main h1')?.textContent).toBe('Could not load the workspace');
    expect(document.activeElement).toBe(tryAgain(app));
  });
});

describe('the sign-in button', () => {
  it('keeps the keyboard while Puter answers and after the sign-in is given up, and takes one press at a time', async () => {
    dom?.uninstall();
    dom = installDom({ hash: '' });
    vi.resetModules();
    let asked = 0;
    let settle = null;
    globalThis.puter = { auth: { signIn: () => { asked++; return new Promise((_, reject) => { settle = reject; }); } } };
    const { authView } = await import('../src/views/auth.js');
    const signedIn = [];
    document.body.append(authView({ onSignedIn: () => signedIn.push(1) }));
    const cta = document.querySelector('.auth-cta');
    expect(cta.textContent).toBe('Sign in');
    cta.focus();
    cta.click();
    expect(asked).toBe(1);
    // Out to Puter: the button says so, and the keyboard stays on it.
    expect(cta.textContent).toBe('Waiting for Puter');
    expect(cta.hasAttribute('disabled')).toBe(false);
    expect(cta.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(cta);
    cta.click();
    expect(asked).toBe(1); // one sign-in, not two
    // The sign-in window closed without signing in: the button is live again, with the keyboard still on it.
    settle(new Error('closed'));
    await dom.tick(5);
    expect(cta.textContent).toBe('Sign in');
    expect(cta.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(cta);
    expect(signedIn).toEqual([]);
    cta.click();
    expect(asked).toBe(2);
  });
});

describe('a view opened in the conversation\'s place from the keyboard', () => {
  const ROUTES = { '/threads': () => json({ threads: [] }), '/messages': () => json({ messages: [], seq: 0 }), '/search': () => json({ results: [], indexed: true }) };

  it('takes the keyboard from the column it replaced (Threads by its shortcut, from the message box) rather than leaving it on the page', async () => {
    const { app, dom: d } = await shell({ routes: ROUTES });
    const box = document.createElement('textarea');
    app.querySelector('.main').append(box);
    box.focus();
    expect(document.activeElement).toBe(box);
    location.hash = `#/ws/${encodeURIComponent(REF)}/threads`; // what Shift+Cmd+T navigates to
    await d.tick(10);
    const view = app.querySelector('.main.list-view');
    expect(view).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(view.contains(document.activeElement)).toBe(true);
    // And on to the Files view from there, the same.
    location.hash = `#/ws/${encodeURIComponent(REF)}/files`;
    await d.tick(10);
    expect(app.querySelector('.main.list-view').contains(document.activeElement)).toBe(true);
  });

  it('leaves the keyboard where it is when it was not in the column (a sidebar row pressed)', async () => {
    const { app, dom: d } = await shell({ routes: ROUTES });
    const row = app.querySelector('.sidebar a[href$="/threads"]');
    row.focus();
    row.click();
    await d.tick(10);
    expect(app.querySelector('.main.list-view')).not.toBeNull();
    // The row is redrawn by the route (aria-current), and the sidebar keeps the keyboard on it.
    expect(app.querySelector('.sidebar').contains(document.activeElement)).toBe(true);
  });
});

describe('the button that loads the older page of a list, pressed from the keyboard', () => {
  const msg = (seq, extra = {}) => ({ conv: 'c1', seq, ts: 1000 + seq, user: 'u-dan', text: `note ${seq}`, kind: 'msg', ...extra });
  const buttonNamed = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);

  it('in the Files view keeps the keyboard on the button while the page is read, takes one press at a time, and lands it on what came', async () => {
    let release = null;
    const asked = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (params) => {
          asked.push(`${params.get('has')}:${params.get('cursor') || ''}`);
          if (params.get('has') !== 'file') return json({ results: [], hasMore: false, cursor: null, indexed: true });
          if (!params.get('cursor')) return json({ results: [msg(9, { attachments: [{ id: 'f9', name: 'plan.pdf', type: 'application/pdf', size: 10 }] })], hasMore: true, cursor: 'older', indexed: true });
          return new Promise((r) => { release = () => r(json({ results: [msg(4, { attachments: [{ id: 'f4', name: 'old.pdf', type: 'application/pdf', size: 10 }] })], hasMore: false, cursor: null, indexed: true })); });
        },
      },
    });
    const { dom: d } = ctx;
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const view = createFilesPage();
    document.body.append(view.el);
    await d.tick(10);
    const more = buttonNamed(view.el, 'Load older files and links');
    expect(more).toBeTruthy();
    more.focus();
    more.click();
    await d.tick(5);
    expect(asked.filter((a) => a === 'file:older').length).toBe(1);
    // Out to the index: the button says so, and the keyboard stays on it rather than jumping to a row.
    const waiting = buttonNamed(view.el, 'Loading');
    expect(waiting).toBeTruthy();
    expect(waiting.hasAttribute('disabled')).toBe(false);
    expect(waiting.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(waiting);
    waiting.click();
    await d.tick(5);
    expect(asked.filter((a) => a === 'file:older').length).toBe(1); // one read, not two
    // The page lands: the older rows are drawn, and the keyboard is on the list, not on the page.
    release();
    await d.tick(10);
    expect([...view.el.querySelectorAll('.files-row strong')].map((n) => n.textContent)).toEqual(['plan.pdf', 'old.pdf']);
    expect(buttonNamed(view.el, 'Loading')).toBeUndefined();
    expect(document.activeElement).not.toBe(document.body);
    expect(view.el.querySelector('.files-list').contains(document.activeElement)).toBe(true);
    view.destroy();
  });

  it('in the search results does the same', async () => {
    let release = null;
    const asked = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/search/note`,
      routes: {
        '/search': (params) => {
          asked.push(params.get('cursor') || '');
          if (!params.get('cursor')) return json({ results: [msg(9)], hasMore: true, cursor: 'older', indexed: true });
          return new Promise((r) => { release = () => r(json({ results: [msg(4)], hasMore: false, cursor: null, indexed: true })); });
        },
      },
    });
    const { dom: d } = ctx;
    ctx.open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('note', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(10);
    const more = buttonNamed(view.el, 'Load more results');
    expect(more).toBeTruthy();
    more.focus();
    more.click();
    await d.tick(5);
    expect(asked.filter((a) => a === 'older').length).toBe(1);
    const waiting = buttonNamed(view.el, 'Loading');
    expect(waiting).toBeTruthy();
    expect(waiting.hasAttribute('disabled')).toBe(false);
    expect(waiting.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(waiting);
    waiting.click();
    await d.tick(5);
    expect(asked.filter((a) => a === 'older').length).toBe(1);
    release();
    await d.tick(10);
    expect(view.el.querySelectorAll('.search-hit').length).toBe(2);
    expect(document.activeElement).not.toBe(document.body);
    expect(view.el.querySelector('.search-results').contains(document.activeElement)).toBe(true);
    view.destroy();
  });
});

describe('a Later action answered after the reader has switched workspaces', () => {
  const OTHER = 'bbbb222200@teamchat-test';
  const saved = (s) => ({ c: 'c1', s, ts: 1000 + s, done: false, message: { seq: s, user: 'u-dan', ts: 1000 + s, text: `note ${s}`, kind: 'msg' } });
  /** The other workspace open, with a Later count of its own, as the shell leaves things when it switches (the view torn down with it). */
  const switchTo = (store, view) => {
    view.destroy();
    view.el.remove();
    store.wsId = OTHER;
    store.ws = { id: 'bbbb222200', name: 'Initech', channels: { x1: { id: 'x1', name: 'general', def: true } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
    store.me = { role: 'member', channels: ['x1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store._savedCount = 3;
    store._reminderCount = 2;
    store._scheduledCount = 1;
  };

  it('does not write the old workspace\'s saved count over the new one\'s badge', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/later`, routes: { '/saved': () => json({ items: [saved(1), saved(2)] }) } });
    const { store, dom: d } = ctx;
    ctx.open();
    let release = null;
    store.saveDone = () => new Promise((r) => { release = r; });
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later', { pane: true });
    document.body.append(view.el);
    await d.tick(10);
    expect(store.savedCount()).toBe(2);
    const done = view.el.querySelector('.view-check');
    expect(done).toBeTruthy();
    done.click();
    await d.tick(5);
    expect(release).not.toBeNull();
    const emitted = [];
    const off = store.on('activity', () => emitted.push(1));
    switchTo(store, view);
    release({});
    await d.tick(10);
    // Initech's count stands; Globex's list, one item shorter, is not counted for it.
    expect(store.savedCount()).toBe(3);
    expect(emitted).toEqual([]);
    off();
  });

  it('nor the old workspace\'s reminder count', async () => {
    const reminder = { id: 'r1', kind: 'reminder', conv: 'c1', seq: 1, dueAt: Date.now() + 3_600_000, message: { seq: 1, user: 'u-dan', ts: 1001, text: 'note', kind: 'msg' } };
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/later`, routes: { '/scheduled': () => json({ scheduled: [], reminders: [reminder] }) } });
    const { store, dom: d } = ctx;
    ctx.open();
    let release = null;
    store.deleteScheduled = () => new Promise((r) => { release = r; });
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later', { pane: true });
    document.body.append(view.el);
    await d.tick(10);
    [...view.el.querySelectorAll('.seg button')].find((b) => b.textContent === 'Reminders').click();
    await d.tick(10);
    expect(store.reminderCount()).toBe(1);
    const done = view.el.querySelector('.view-check');
    expect(done).toBeTruthy();
    done.click();
    await d.tick(5);
    expect(release).not.toBeNull();
    switchTo(store, view);
    release({});
    await d.tick(10);
    expect(store.reminderCount()).toBe(2);
    expect(store.scheduledCount()).toBe(1);
  });
});

describe('the History menu and a direct message on the host of a shared channel', () => {
  const HOST = 'cccc333300@teamchat-test';
  const link = (patch) => ({ ref: HOST, ws: null, me: null, act: null, since: 0, convs: new Map(), loaded: false, loading: null, syncing: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {}, ...patch });

  it('keeps the conversation in Recent while the host is still to be read, out of reach, or lost, and forgets it only once the host has answered without it', async () => {
    const { app, store, dom: d } = await shell({ routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { noteRecent, recentConvs } = await import('../src/lib/recent.js');
    const { closeMenu } = await import('../src/ui/menu.js');
    noteRecent(REF, 'c9'); // a channel that is gone
    noteRecent(REF, 'h_dmz'); // a direct message on the host, which lists it once read
    noteRecent(REF, 'c1');
    const history = app.querySelector('.top-nav[aria-label="History"]');
    const listed = () => [...document.querySelectorAll('.menu [role="menuitemradio"], .menu [role="menuitem"]')].map((n) => n.textContent.trim());
    // The host is being read for the first time.
    store.links.set(HOST, link({ loading: Promise.resolve() }));
    history.click();
    expect(listed()).toEqual(['#general']);
    expect(recentConvs(REF)).not.toContain('c9'); // gone for good: forgotten
    expect(recentConvs(REF)).toContain('h_dmz'); // not gone, only not here yet
    closeMenu();
    // Out of reach, to be tried again.
    store.links.set(HOST, link({ error: new Error('Could not reach the host'), failures: 2, retryAt: Date.now() + 60_000 }));
    history.click();
    expect(recentConvs(REF)).toContain('h_dmz');
    closeMenu();
    // The connection ended (an admin may connect the workspaces again).
    store.links.set(HOST, link({ error: new Error('The connection is over'), lost: true }));
    history.click();
    expect(recentConvs(REF)).toContain('h_dmz');
    closeMenu();
    // The host answered, and the direct message is not among the reader's there: gone.
    store.links.set(HOST, link({ loaded: true, ws: { id: 'cccc333300', name: 'Host', members: {} }, me: { dms: {} } }));
    history.click();
    expect(recentConvs(REF)).not.toContain('h_dmz');
    expect(listed()).toEqual(['#general']);
    closeMenu();
    await d.tick(5); // the menus' deferred listeners fire while the page is still up
  });
});

describe('a popover placed near the edge of a phone held sideways', () => {
  it('stays clear of the notch\'s room on either side, and of the status bar and home indicator, rather than 8px from the window\'s edge', async () => {
    dom?.uninstall();
    dom = installDom({ hash: '', width: 844, height: 390 });
    vi.resetModules();
    const { safeInsets } = await import('../src/ui/dom.js');
    const { openMenu, pointAnchor, closeMenu } = await import('../src/ui/menu.js');
    // Nothing laid out (the fake DOM gives no box): the whole window is safe, and a popover goes 8px from the edge as before.
    expect(safeInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const probe = document.querySelector('.safe-probe');
    expect(probe).not.toBeNull();
    expect(probe.getAttribute('aria-hidden')).toBe('true');
    let pop = openMenu(pointAnchor(840, 100), [{ label: 'Copy link', onSelect() {} }]);
    expect(pop.node.style.left).toBe('836px');
    expect(pop.node.style.top).toBe('106px');
    closeMenu();
    // A phone held sideways: 59px of notch and corner on either side, 21px of home indicator below.
    probe.getBoundingClientRect = () => ({ left: 59, top: 0, right: 844 - 59, bottom: 390 - 21, width: 844 - 118, height: 390 - 21, x: 59, y: 0 });
    expect(safeInsets()).toEqual({ top: 0, right: 59, bottom: 21, left: 59 });
    // A long press at the right edge: the menu is pushed in past the room kept there.
    pop = openMenu(pointAnchor(840, 100), [{ label: 'Copy link', onSelect() {} }]);
    expect(pop.node.style.left).toBe(`${844 - 8 - 59}px`);
    closeMenu();
    // And at the left edge.
    pop = openMenu(pointAnchor(2, 100), [{ label: 'Copy link', onSelect() {} }]);
    expect(pop.node.style.left).toBe('67px');
    closeMenu();
    // Opening upward from a point near the top: not under the status bar's room either.
    probe.getBoundingClientRect = () => ({ left: 0, top: 47, right: 390, bottom: 844 - 34, width: 390, height: 844 - 81, x: 0, y: 47 });
    dom.setEnv({ width: 390, height: 844 });
    pop = openMenu(pointAnchor(100, 30), [{ label: 'Copy link', onSelect() {} }], { side: 'top' });
    expect(pop.node.style.top).toBe('36px'); // below the point, since above it would be under the bar
    closeMenu();
    await dom.tick(5);
  });

  it('closed in the same breath it opened (a route, a menu swapped for another), leaves no listener on the page behind it', async () => {
    dom?.uninstall();
    dom = installDom({ hash: '' });
    vi.resetModules();
    const { openMenu, closeMenu } = await import('../src/ui/menu.js');
    const count = (target, type) => (target._listeners.get(type) || []).length;
    const before = { down: count(document, 'pointerdown'), click: count(document, 'click'), key: count(document, 'keydown'), scroll: count(document, 'scroll'), resize: count(window, 'resize') };
    const anchor = document.createElement('button');
    document.body.append(anchor);
    // Opened and closed before the deferred listeners were added.
    openMenu(anchor, [{ label: 'Copy link', onSelect() {} }]);
    closeMenu();
    await dom.tick(5);
    expect(count(document, 'pointerdown')).toBe(before.down);
    expect(count(document, 'click')).toBe(before.click);
    expect(count(document, 'keydown')).toBe(before.key);
    expect(count(document, 'scroll')).toBe(before.scroll);
    expect(count(window, 'resize')).toBe(before.resize);
    // Opened, given its tick, then closed: the listeners come and go with it.
    openMenu(anchor, [{ label: 'Copy link', onSelect() {} }]);
    await dom.tick(5);
    expect(count(document, 'pointerdown')).toBe(before.down + 1);
    closeMenu();
    expect(count(document, 'pointerdown')).toBe(before.down);
    expect(count(window, 'resize')).toBe(before.resize);
  });

  it('gives a tall menu the status bar\'s and home indicator\'s room in its height, in the stylesheet', () => {
    const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim().replace(/\s+/g, ' ') })).find((r) => r.sel === '.menu[role="menu"]');
    expect(rule?.body).toContain('max-height: calc(100dvh - 16px - var(--safe-t) - var(--safe-b))');
  });
});

describe('the Directory\'s search box', () => {
  it('finds a person typed as @username and a channel typed as #name, as the sidebar\'s filter does', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    const { dom: d } = ctx;
    ctx.open();
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    const search = view.el.querySelector('.dir-search');
    const names = () => [...view.el.querySelectorAll('.dir-card-name')].map((n) => n.textContent);
    d.type(search, '@dan');
    expect(names()).toEqual(['Dan Ito']);
    d.type(search, 'dan');
    expect(names()).toEqual(['Dan Ito']);
    d.type(search, '@nobody');
    expect(view.el.querySelector('.empty h3')?.textContent).toBe('Nobody matches');
    view.el.querySelectorAll('.dir-tabs [role="tab"]')[1].click();
    d.type(search, '#ops');
    expect([...view.el.querySelectorAll('.dir-row-text strong')].map((n) => n.textContent)).toEqual(['ops']);
    view.destroy();
  });
});

describe('the DMs pane with Unreads on and a name typed', () => {
  it('says that nothing unread is from anyone so called, rather than that nothing is unread', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms` });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.members['u-eve'] = { role: 'member', name: 'Eve Park', username: 'eve' };
    store.me.dms.dm_e = { members: ['u-me', 'u-eve'], createdAt: 4 };
    store.act.c = { dm_e: { s: 3, t: 1 } }; // Eve's conversation has three messages, none read
    localStorage.setItem('teamchat:dms-unreads', '1');
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(5);
    const rows = () => [...pane.el.querySelectorAll('.pane-row strong')].map((n) => n.textContent);
    const empty = () => pane.el.querySelector('.side-empty')?.textContent;
    expect(rows()).toEqual(['Eve Park']); // Unreads on: Dan's read conversation is not shown
    d.type(pane.el.querySelector('.side-filter-input'), 'dan');
    expect(rows()).toEqual([]);
    expect(empty()).toBe('Nothing unread from anyone called “dan”');
    d.type(pane.el.querySelector('.side-filter-input'), '');
    expect(rows()).toEqual(['Eve Park']);
    // The switch off, the name alone: as before.
    pane.el.querySelector('.switch').click();
    d.type(pane.el.querySelector('.side-filter-input'), 'zed');
    expect(empty()).toBe('Nobody called “zed”');
    pane.destroy();
  });
});

describe('focusMemo, when the redraw keeps the very control that had the keyboard', () => {
  it('puts the keyboard back on that control wherever the redraw put it, not on a neighbour with the same label; a kept control now hidden, or one gone, still falls to the guess', async () => {
    dom?.uninstall();
    dom = installDom({ hash: '' });
    vi.resetModules();
    const { focusMemo, el } = await import('../src/ui/dom.js');
    // A browser blurs a focused control the moment it leaves the page and
    // does not focus it again when it is appended again; the helper keeps
    // its reference, so the blur is done here as the browser would.
    const detach = (node) => { node.remove(); document._active = null; };
    const box = el('div');
    document.body.append(box);
    const row = (text) => el('button', { type: 'button', 'aria-label': 'Open in conversation' }, text);
    const kept = row('kept');
    box.append(kept, row('second'));
    kept.focus();
    let restore = focusMemo(box);
    // Redrawn: a new row first, the kept control appended again after it, so the same label stands at its old place.
    detach(kept);
    box.replaceChildren(row('fresh'), kept);
    expect(document.activeElement).toBe(document.body);
    restore();
    expect(document.activeElement).toBe(kept);
    // Kept, but hidden by the redraw: not focused (a browser would not); the guess by place stands in.
    restore = focusMemo(box); // kept has the keyboard, second of two
    detach(kept);
    box.replaceChildren(el('div', { hidden: true }, kept), row('fresh'));
    restore();
    expect(document.activeElement).not.toBe(kept);
    expect(document.activeElement.textContent).toBe('fresh');
    // Kept, but disabled meanwhile (a control held for its action): the guess again.
    const held = row('held');
    box.replaceChildren(row('a'), held);
    held.focus();
    restore = focusMemo(box);
    held.disabled = true; // the keyboard falls to the page (the focus fixup rule)
    expect(document.activeElement).toBe(document.body);
    detach(held);
    box.replaceChildren(row('a2'), held);
    restore();
    expect(document.activeElement.textContent).toBe('a2');
    // Gone for good: the guess by label and place, as before.
    const gone = row('gone');
    box.replaceChildren(row('a'), gone, row('c'));
    gone.focus();
    restore = focusMemo(box);
    detach(gone);
    box.replaceChildren(row('a'), row('b'), row('c'));
    restore();
    expect(document.activeElement.textContent).toBe('b');
  });
});

describe('the notch\'s room on either side, in the stylesheets, for the layers fixed over the window', () => {
  // The fake DOM applies no CSS, so the contract is read from the text, as
  // the pass-14 and pass-15 files read the safe-area rules.
  const read = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));
  const components = rulesOf(read('components.css'));
  const base = rulesOf(read('base.css'));
  const bodiesOf = (rules, sel) => rules.filter((r) => r.sel === sel).map((r) => r.body);

  it('is kept by a dialog drawn as a bottom sheet across a phone, by the media viewer\'s bar, stage and arrows, and by the skip link', () => {
    // The sheet, full width on a phone: the notch's room on both sides, as the shell keeps it.
    const sheet = bodiesOf(components, '.modal-panel')[0];
    expect(sheet).toContain('width: 100%');
    expect(sheet).toContain('padding: 8px calc(20px + var(--safe-r)) calc(20px + var(--safe-b)) calc(20px + var(--safe-l))');
    // The viewer: fixed over the whole window, so nothing under it keeps the room for it.
    expect(bodiesOf(components, '.viewer-head')[0]).toContain('padding: 10px calc(12px + var(--safe-r)) 10px calc(16px + var(--safe-l))');
    expect(bodiesOf(components, '.viewer-stage')[0]).toContain('padding: 8px calc(8px + var(--safe-r)) calc(8px + var(--safe-b)) calc(8px + var(--safe-l))');
    expect(bodiesOf(components, '.viewer-stage')).toContain('padding: 8px calc(72px + var(--safe-r)) 16px calc(72px + var(--safe-l));');
    expect(bodiesOf(components, '.viewer-nav.prev')[0]).toBe('left: calc(12px + var(--safe-l));');
    expect(bodiesOf(components, '.viewer-nav.next')[0]).toBe('right: calc(12px + var(--safe-r));');
    // The skip link, fixed at the top left corner.
    expect(bodiesOf(base, '.skip-link')[0]).toContain('inset-inline-start: calc(8px + var(--safe-l))');
  });
});
