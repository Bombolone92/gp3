/**
 * Seventeenth review pass, the shell: the app frame, the sidebar and its
 * panes, the list views, driven in node through tests/helpers/dom.js (a
 * small DOM: elements, selectors, bubbling events, focus with the focus
 * fixup rule, a hash location that fires hashchange on the next tick,
 * matchMedia by viewport; no CSS). Every test boots a fresh DOM and a fresh
 * module registry. Puter is faked at `puter.workers.exec`, as in
 * tests/ui-shell-pass16.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

const tryAgain = (root) => [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
const down = () => json({ code: 'error', message: 'The server is down for a moment' }, 500);

describe('Try again pressed from the keyboard on a workspace that could not be loaded, when the retry succeeds', () => {
  /** The shell mounted at `hash`, the workspace refusing to open the first `failures` times. */
  async function shellFailingFirst(hash, routes, failures = 1) {
    const ctx = await boot({ hash, routes });
    const { store, dom: d } = ctx;
    const { ApiError } = await import('../src/lib/api.js');
    let left = failures;
    store.openWorkspace = async () => {
      if (left-- > 0) throw new ApiError(500, 'error', 'The server is down for a moment');
      ctx.open();
      store.emit('workspace');
    };
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    expect(app.querySelector('.main h1')?.textContent).toBe('Could not load the workspace');
    return { ...ctx, app };
  }

  it('hands the keyboard to the view that takes the column (Threads), as a Try again that fails again keeps it on the button', async () => {
    const { app, dom: d } = await shellFailingFirst(`#/ws/${encodeURIComponent(REF)}/threads`, { '/threads': () => json({ threads: [] }), '/messages': () => json({ messages: [], seq: 0 }) });
    tryAgain(app).focus();
    tryAgain(app).click();
    await d.tick(10);
    const view = app.querySelector('.main.list-view');
    expect(view).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(view.contains(document.activeElement)).toBe(true);
  });

  it('on a phone, hands it to the channel list that takes the column', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}`, width: 390, coarse: true, hover: false, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    const { ApiError } = await import('../src/lib/api.js');
    let left = 1;
    store.openWorkspace = async () => {
      if (left-- > 0) throw new ApiError(500, 'error', 'The server is down for a moment');
      ctx.open();
      store.emit('workspace');
    };
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
    expect(app.querySelector('.shell').classList.contains('show-sidebar')).toBe(true);
    const sidebar = app.querySelector('.sidebar');
    expect(document.activeElement).not.toBe(document.body);
    expect(sidebar.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.localName).not.toBe('input');
  });

  it('leaves the keyboard alone when Try again was pressed with a pointer (nothing had it)', async () => {
    const { app, dom: d } = await shellFailingFirst(`#/ws/${encodeURIComponent(REF)}/threads`, { '/threads': () => json({ threads: [] }), '/messages': () => json({ messages: [], seq: 0 }) });
    expect(document.activeElement).toBe(document.body);
    tryAgain(app).click();
    await d.tick(10);
    expect(app.querySelector('.main.list-view')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('"Search older months", pressed from the keyboard under an empty first page', () => {
  const msg = (seq) => ({ conv: 'c1', seq, ts: 1000 + seq, user: 'u-dan', text: `note ${seq}`, kind: 'msg' });
  const buttonNamed = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);

  it('keeps the keyboard on the button while the older months are read, and lands it on the hits that come', async () => {
    let release = null;
    const asked = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/search/note`,
      routes: {
        '/search': (params) => {
          asked.push(params.get('cursor') || '');
          if (!params.get('cursor')) return json({ results: [], hasMore: true, cursor: 'older', indexed: true });
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
    const older = buttonNamed(view.el, 'Search older months');
    expect(older).toBeTruthy();
    older.focus();
    older.click();
    await d.tick(5);
    expect(asked.filter((a) => a === 'older').length).toBe(1);
    // Out to the index: the button says so and holds the keyboard, as "Load more results" does under a page of hits.
    const waiting = buttonNamed(view.el, 'Loading');
    expect(waiting).toBeTruthy();
    expect(waiting.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(waiting);
    waiting.click();
    await d.tick(5);
    expect(asked.filter((a) => a === 'older').length).toBe(1); // one read, not two
    release();
    await d.tick(10);
    expect(view.el.querySelectorAll('.search-hit').length).toBe(1);
    expect(document.activeElement).not.toBe(document.body);
    expect(view.el.querySelector('.search-results').contains(document.activeElement)).toBe(true);
    view.destroy();
  });

  it('still draws the wait for a fresh search with nothing found yet', async () => {
    let release = null;
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/search/note`,
      routes: { '/search': () => new Promise((r) => { release = () => r(json({ results: [], hasMore: false, cursor: null, indexed: true })); }) },
    });
    const { dom: d } = ctx;
    ctx.open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('note', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(5);
    expect(view.el.querySelector('[aria-label="Searching"]')).not.toBeNull();
    expect(buttonNamed(view.el, 'Loading')).toBeUndefined();
    release();
    await d.tick(10);
    expect(view.el.querySelector('.empty h3')?.textContent).toBe('No results for “note”');
    view.destroy();
  });
});

describe('Join in the Directory, on a shared channel whose host does not answer', () => {
  const HOST = 'bbbb222200@teamchat-test';
  const said = () => [...document.querySelectorAll('.toast span')].map((n) => n.textContent);

  it('says the channel was joined here and opens when the host answers, not the network\'s "Failed to fetch"', async () => {
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/directory`,
      routes: {
        '/channels/c4/join': () => json({ ok: true, shared: { ref: HOST, conn: 'k1', token: 't1' } }),
        '/connect/join': () => { throw new TypeError('Failed to fetch'); },
      },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c4 = { id: 'c4', name: 'shared-x', shared: { ref: HOST, ch: 'hc4', host: 'Acme' } };
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('[role="tab"]')[1].click(); // Channels
    const join = [...view.el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Join #shared-x');
    expect(join).toBeTruthy();
    join.click();
    await d.tick(20);
    // Joined here: the store kept the join, and the row says Open.
    expect(store.isJoined('c4')).toBe(true);
    expect(said()).not.toContain('Failed to fetch');
    expect(said().some((t) => t.startsWith('Joined #shared-x here.') && t.includes('Acme'))).toBe(true);
    view.destroy();
  });

  it('says the refusal\'s words when the host would not have them (the join undone here)', async () => {
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/directory`,
      routes: {
        '/channels/c4/join': () => json({ ok: true, shared: { ref: HOST, conn: 'k1', token: 't1' } }),
        '/connect/join': () => json({ code: 'archived', message: 'This channel is archived' }, 409),
        '/channels/c4/leave': () => json({ ok: true }),
      },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c4 = { id: 'c4', name: 'shared-x', shared: { ref: HOST, ch: 'hc4', host: 'Acme' } };
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('[role="tab"]')[1].click();
    [...view.el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Join #shared-x').click();
    await d.tick(20);
    expect(store.isJoined('c4')).toBe(false);
    expect(said()).toContain('This channel is archived');
    view.destroy();
  });
});

describe('a details row held busy while the worker answers, in the stylesheet', () => {
  // The fake DOM applies no CSS, so the contract is read from the text, as
  // the pass-14 to pass-16 files read the safe-area rules.
  const read = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));

  it('is dimmed and takes no press, as a busy button is', () => {
    const app = rulesOf(read('app.css'));
    const busyRow = app.filter((r) => r.sel.split(',').map((s) => s.trim()).includes('.details-row[aria-busy="true"]'));
    expect(busyRow.length).toBeGreaterThan(0);
    const body = busyRow.map((r) => r.body).join(' ');
    expect(body).toMatch(/opacity: 0?\.\d+/);
    expect(body).toContain('pointer-events: none');
    // The same look the buttons get for the mark.
    const btn = rulesOf(read('components.css')).find((r) => r.sel.split(',').map((s) => s.trim()).includes('.btn[aria-busy="true"]'));
    expect(btn.body).toContain('pointer-events: none');
  });
});

describe('the gear at the foot of the sidebar', () => {
  it('says whose settings it opens, as the rail\'s account menu does, rather than a bare "Settings"', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { dom: d } = ctx;
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    const foot = [...app.querySelectorAll('.side-footer button')];
    expect(foot.length).toBe(3);
    const gear = foot.find((b) => b.getAttribute('aria-label') === 'Profile and settings');
    expect(gear).toBeTruthy();
    expect(gear.getAttribute('title')).toBe('Profile and settings');
    expect(foot.some((b) => b.getAttribute('aria-label') === 'Settings')).toBe(false);
    // The reader's own card beside it opens the same dialog, and says so the same way.
    expect(app.querySelector('.side-me').getAttribute('aria-label')).toMatch(/^Your profile and settings/);
  });
});

describe('the theme button at the foot of the rail', () => {
  it('changes its icon and name with the theme, not only once the preference has been written', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    ctx.open();
    let settle = null;
    const asked = [];
    store.updatePrefs = (patch) => { asked.push(patch); return new Promise((r) => { settle = r; }); };
    const { renderRail } = await import('../src/ui/rail.js');
    const rail = document.createElement('nav');
    document.body.append(rail);
    renderRail(rail);
    const theme = () => [...rail.querySelectorAll('button')].find((b) => /theme$/.test(b.getAttribute('aria-label') || ''));
    expect(theme().getAttribute('aria-label')).toBe('Switch to dark theme');
    theme().focus();
    theme().click();
    await d.tick(0);
    // The page is dark, and the button says so before the account has answered.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(asked).toEqual([{ theme: 'dark' }]);
    expect(theme().getAttribute('aria-label')).toBe('Switch to light theme');
    expect(theme().getAttribute('title')).toBe('Light theme');
    // The redraw kept the keyboard on the button.
    expect(document.activeElement).toBe(theme());
    settle(store.profile.prefs);
    await d.tick(5);
    expect(theme().getAttribute('aria-label')).toBe('Switch to light theme');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('the Direct messages list\'s box', () => {
  it('finds a person typed with their @, as the sidebar\'s filter and the Directory do', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { dom: d } = ctx;
    ctx.open();
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(10);
    const rows = () => [...pane.el.querySelectorAll('.pane-row')].map((r) => r.getAttribute('href'));
    const box = pane.el.querySelector('.side-filter-input');
    expect(rows().length).toBe(1);
    d.type(box, '@dan');
    expect(rows().length).toBe(1);
    expect(pane.el.querySelector('.side-empty')).toBeNull();
    d.type(box, '@Dan I');
    expect(rows().length).toBe(1);
    d.type(box, 'dan');
    expect(rows().length).toBe(1);
    // Somebody who is not there is still nobody, said with what was typed.
    d.type(box, '@eve');
    expect(rows().length).toBe(0);
    expect(pane.el.querySelector('.side-empty')?.textContent).toBe('Nobody called “@eve”');
    pane.destroy();
  });
});

describe('the keys of the Direct messages list\'s box, as the sidebar filter has them', () => {
  async function pane() {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    ctx.open();
    // A second conversation, so the first match is a choice.
    ctx.store.me.dms.dm_e = { members: ['u-me', 'u-eve'], createdAt: 2 };
    ctx.store.ws.members['u-eve'] = { role: 'member', name: 'Eve Adams', username: 'eve' };
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const view = createDmsPane();
    document.body.append(view.el);
    await ctx.dom.tick(10);
    const box = view.el.querySelector('.side-filter-input');
    const rows = () => [...view.el.querySelectorAll('.pane-row')];
    return { ...ctx, view, box, rows };
  }

  it('goes into the list on the bare down arrow, and back to the box on the up arrow from the first row', async () => {
    const { dom: d, view, box, rows } = await pane();
    expect(rows().length).toBe(2);
    box.focus();
    d.key(box, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[0]);
    d.key(rows()[0], 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    d.key(rows()[1], 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);
    d.key(rows()[0], 'ArrowUp');
    expect(document.activeElement).toBe(box);
    // Held with Alt, the arrow is the next-conversation shortcut: it passes, and the keyboard stays in the box.
    const alt = d.key(box, 'ArrowDown', { altKey: true });
    expect(alt.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(box);
    view.destroy();
  });

  it('opens the first match on Enter, opens nothing with nothing typed or matching, and leaves an IME\'s Enter alone', async () => {
    const { dom: d, view, box, rows } = await pane();
    const before = location.hash;
    box.focus();
    d.key(box, 'Enter'); // nothing typed: nothing to open
    expect(location.hash).toBe(before);
    d.type(box, 'eve');
    expect(rows().length).toBe(1);
    const ime = d.key(box, 'Enter', { isComposing: true }); // the candidate being taken, not the row
    expect(ime.defaultPrevented).toBe(false);
    expect(location.hash).toBe(before);
    d.key(box, 'Enter');
    expect(location.hash).toBe(rows()[0].getAttribute('href'));
    expect(location.hash).toContain('/dms/c/dm_e');
    d.type(box, 'zed'); // nobody: Enter opens nothing, and does not go searching messages
    const at = location.hash;
    d.key(box, 'Enter');
    expect(location.hash).toBe(at);
    // Escape with words in the box clears them and stops there, as the sidebar's does.
    d.key(box, 'Escape');
    expect(box.value).toBe('');
    expect(rows().length).toBe(2);
    view.destroy();
  });
});

describe('the sidebar filter\'s arrows', () => {
  it('go down into the list from the box and, from the first row, back up to the box', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { dom: d } = ctx;
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    const sidebar = app.querySelector('.sidebar');
    const box = sidebar.querySelector('.side-filter-input');
    const rows = () => [...sidebar.querySelectorAll('.side-item')];
    expect(rows().length).toBeGreaterThan(2);
    box.focus();
    d.key(box, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[0]);
    d.key(rows()[0], 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    // From the second row the list's own arrow goes to the first, and stops there.
    d.key(rows()[1], 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);
    // An IME's arrow is the composition's: it passes, and the keyboard stays on the row.
    // (Held with Alt the arrow is the previous-conversation shortcut, which the shell's shortcuts take; see the DMs pane's test for the box's own rule.)
    expect(d.key(rows()[0], 'ArrowUp', { isComposing: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows()[0]);
    // The bare arrow from the first row comes back to the box.
    d.key(rows()[0], 'ArrowUp');
    expect(document.activeElement).toBe(box);
  });
});

describe('the reader\'s own card at the foot of the sidebar', () => {
  it('opens the settings on the status when it shows one, at the top otherwise (no status, or notifications paused)', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    // The settings dialog is a call the card makes, with a section or without;
    // the dialog itself is another file's, so that one export is stood in for
    // here, for this test's fresh module registry alone (a file-level mock
    // outlives vi.resetModules, and its real half kept the first test's
    // toast root): the rest of the dialogs stay real.
    const calls = vi.fn();
    vi.doMock('../src/ui/dialogs.js', async (importOriginal) => ({ ...(await importOriginal()), settingsDialog: calls }));
    try {
      const { mountShell } = await import('../src/ui/shell.js');
      const app = document.createElement('div');
      app.id = 'app';
      document.body.append(app);
      mountShell(app);
      await d.tick(10);
      const card = () => app.querySelector('.side-me');
      const line = () => card().querySelector('.me-text > span:last-child').textContent;
      // No status: the line is the username, and the card opens at the top.
      expect(line()).toBe('@me');
      card().click();
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0]).toEqual([]);
      // A status set: the line is the status, and the card opens on it, as the rail's "Set a status" does.
      store.ws.members['u-me'].status = { emoji: '🏝', text: 'Away until Monday' };
      store.emit('profile');
      await d.tick(5);
      expect(line()).toBe('🏝 Away until Monday');
      card().click();
      expect(calls).toHaveBeenCalledTimes(2);
      expect(calls.mock.calls[1]).toEqual([{ section: 'status' }]);
      // Notifications paused: the line is about the pause (the bell's), and the card opens at the top again.
      store.profile.prefs.pauseUntil = Date.now() + 60_000;
      store.emit('profile');
      await d.tick(5);
      expect(line()).toBe('Notifications paused');
      card().click();
      expect(calls).toHaveBeenCalledTimes(3);
      expect(calls.mock.calls[2]).toEqual([]);
    } finally {
      vi.doUnmock('../src/ui/dialogs.js');
    }
  });
});

describe('a reload the reader did not ask for that fails (Threads, on a poll)', () => {
  const root = { seq: 1, user: 'u-dan', ts: 1000, text: 'the root of it', kind: 'msg', replyCount: 0 };

  it('keeps the cards on screen, the reply being typed with them, rather than replacing them with "Could not load"', async () => {
    let answer = () => json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 2000, unread: 0, root }] });
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/threads`,
      routes: { '/threads': () => answer(), '/messages': () => json({ messages: [], seq: 0 }) },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('threads');
    document.body.append(view.el);
    await d.tick(10);
    const card = () => view.el.querySelector('.thread-card');
    expect(card()).not.toBeNull();
    const box = card().querySelector('textarea');
    expect(box).not.toBeNull();
    d.type(box, 'half a reply');
    box.focus();
    store.emit('workspace'); // the first poll only notes where the threads stand
    await d.tick(5);
    expect(card()).not.toBeNull();
    // News on a thread brings a reload the reader did not ask for; the server does not answer it.
    answer = down;
    store.me.threads = { c1_t1: 1 };
    store.emit('workspace');
    await d.tick(10);
    expect(card()).not.toBeNull();
    expect(card().querySelector('textarea')).toBe(box);
    expect(box.value).toBe('half a reply');
    expect(document.activeElement).toBe(box);
    expect(tryAgain(view.el)).toBeUndefined();
    // The next poll, with nothing new on the threads, asks again all the same; the worker answers, and the list follows.
    answer = () => json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 2000, unread: 1, root }, { id: 'c2_t4', conv: 'c2', seq: 4, at: 2500, unread: 0, root: { ...root, seq: 4, text: 'another' } }] });
    const asked = ctx.calls.filter((c) => c.includes('/threads')).length;
    store.emit('workspace');
    await d.tick(10);
    expect(ctx.calls.filter((c) => c.includes('/threads')).length).toBe(asked + 1);
    expect(view.el.querySelectorAll('.thread-card').length).toBe(2);
    // Answered, the list is at rest again: a poll with nothing new asks nothing.
    store.emit('workspace');
    await d.tick(10);
    expect(ctx.calls.filter((c) => c.includes('/threads')).length).toBe(asked + 1);
    view.destroy();
  });

  it('in the Later view too (its reload after a Send now the worker no longer knew), the next poll asking again', async () => {
    const entry = { id: 's1', conv: 'c1', dueAt: Date.now() + 3600_000, text: 'later on', kind: 'message' };
    let list = () => json({ scheduled: [entry], reminders: [] });
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/later`,
      routes: {
        '/scheduled/s1': () => json({ code: 'not_found', message: 'Nothing scheduled with that id' }, 404),
        '/scheduled': () => list(),
      },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await d.tick(10);
    [...view.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Scheduled').click();
    await d.tick(10);
    expect(view.el.querySelectorAll('.sched-row').length).toBe(1);
    store.emit('workspace');
    await d.tick(5);
    // Send now: the worker no longer has the entry (deleted from another tab), and the list read for the truth does not come.
    list = down;
    [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Send now').click();
    await d.tick(20);
    expect(view.el.querySelectorAll('.sched-row').length).toBe(1);
    expect(tryAgain(view.el)).toBeUndefined();
    // The next poll: the list is read again, and shows what the worker holds.
    list = () => json({ scheduled: [], reminders: [] });
    const asked = ctx.calls.filter((c) => c.startsWith('GET') && c.endsWith('/scheduled')).length;
    store.emit('workspace');
    await d.tick(10);
    expect(ctx.calls.filter((c) => c.startsWith('GET') && c.endsWith('/scheduled')).length).toBe(asked + 1);
    expect(view.el.querySelectorAll('.sched-row').length).toBe(0);
    expect(view.el.querySelector('.empty h3')?.textContent).toBe('Nothing scheduled');
    view.destroy();
  });

  it('still says so when there was nothing on screen to keep (the first load failed, and the reload too)', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads`, routes: { '/threads': down, '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('threads', { pane: true });
    document.body.append(view.el);
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    store.emit('workspace');
    await d.tick(5);
    store.me.threads = { c1_t1: 1 };
    store.emit('workspace');
    await d.tick(10);
    expect(tryAgain(view.el)).toBeTruthy();
    view.destroy();
  });
});
