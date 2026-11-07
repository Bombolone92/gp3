/**
 * Nineteenth review pass, the shell: the toast, the Direct messages pane,
 * the sidebar and the app frame, driven in node through tests/helpers/dom.js
 * (a small DOM: elements, selectors, bubbling events, focus with the focus
 * fixup rule, a hash location that fires hashchange on the next tick,
 * matchMedia by viewport and pointer; no CSS). Every test boots a fresh DOM
 * and a fresh module registry. Puter is faked at `puter.workers.exec`, as
 * in tests/ui-shell-pass18.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.js';

// The conversation column stands in as a box with a message box in it, the
// place the shell and the toast hand the keyboard to.
vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    const back = document.createElement('button');
    back.className = 'icon-btn back';
    back.setAttribute('aria-label', 'Back to conversations');
    const box = document.createElement('textarea');
    node.append(back, box);
    return { el: node, destroy() {}, renderHeader() {}, tab: () => 'messages', setTab() {}, jumpTo() {} };
  },
}));
vi.mock('../src/ui/huddle.js', () => ({
  mountHuddleDock() {},
  joinHuddleFlow() {},
  huddleButton() { return document.createElement('span'); },
  createHuddleBar() { return { el: document.createElement('div'), destroy() {} }; },
}));
// The thread panel stands in as its close button alone.
vi.mock('../src/ui/panel.js', () => ({
  renderThreadPanel: (panelEl, { onClose }) => {
    const close = document.createElement('button');
    close.className = 'icon-btn panel-close';
    close.setAttribute('aria-label', 'Close thread');
    close.addEventListener('click', onClose);
    panelEl.append(close);
    return { destroy() {}, jumpTo() {} };
  },
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

describe('a toast\'s buttons pressed on a touch screen', () => {
  /** A message box in the column, the toast module, and a fresh DOM on a coarse pointer. */
  async function touch() {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, width: 390, coarse: true, hover: false });
    ctx.open();
    const main = document.createElement('div');
    main.className = 'main';
    const box = document.createElement('textarea');
    main.append(box);
    document.body.append(main);
    const { toast } = await import('../src/ui/toast.js');
    return { ...ctx, toast, box };
  }

  it('do not hand the keyboard to the message box, which would bring the phone\'s keyboard up', async () => {
    const { toast, box, dom: d } = await touch();
    // Nothing focused when the toast came (a tap on a message's menu brought it).
    expect(document.activeElement).toBe(document.body);
    toast('Saved for later', { dismissible: true, action: { label: 'Undo', onClick() {} } });
    // The tap focuses the button, as Chrome's does, before the click.
    const close = document.querySelector('.toast-close');
    close.focus();
    close.click();
    await d.tick(450);
    expect(document.querySelector('.toast')).toBeNull();
    expect(document.activeElement).not.toBe(box);
    // The box itself under the finger when the toast came: not back to it either.
    box.focus();
    toast('Message not sent', { dismissible: true });
    const close2 = document.querySelector('.toast-close');
    close2.focus();
    close2.click();
    await d.tick(450);
    expect(document.activeElement).not.toBe(box);
  });

  it('still hand it back to a control that is not a text box', async () => {
    const { toast, dom: d } = await touch();
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    toast('Removed from Later', { action: { label: 'Undo', onClick() {} } });
    const undo = document.querySelector('.toast-action');
    undo.focus();
    undo.click();
    await d.tick(450);
    expect(document.activeElement).toBe(other);
  });
});

describe('the Direct messages list and a conversation on a host still being read', () => {
  const HOST = 'cccc333300@teamchat-test';
  const link = (patch) => ({ ref: HOST, ws: null, me: null, act: null, since: 0, convs: new Map(), loaded: false, loading: null, syncing: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {}, ...patch });

  it('says the line is on its way while the host is being read for the first time, and that the host could not be reached once a read has failed', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d, calls } = ctx;
    ctx.open();
    // The host is being read (its link's first load is out) and nothing has failed.
    const loading = link({ loaded: false, loading: new Promise(() => {}), error: null });
    store.links.set(HOST, loading);
    store.me.dms.h_hc9 = { members: ['u-me', 'u-ext'], host: HOST, createdAt: 5 };
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(10);
    const row = () => [...pane.el.querySelectorAll('.pane-row')].find((r) => r.getAttribute('href').includes('h_hc9'));
    const text = () => row().querySelector('.pane-row-text').textContent;
    expect(row()).toBeTruthy();
    // Not read from the host yet, and not said to be out of reach either: the wait is drawn as the wait.
    expect(calls.some((c) => c.includes('/conv/hc9/messages'))).toBe(false);
    expect(text()).not.toContain('Could not reach');
    expect(text()).not.toContain('No messages yet');
    expect(text()).toContain('…');
    // The read fails: the host is out of reach now, and the row says so.
    loading.loading = null;
    loading.error = new Error('Failed to fetch');
    loading.failures = 1;
    store.emit('workspace');
    await d.tick(10);
    expect(text()).toContain('Could not reach');
    // A retry out again after that failure is still a host that could not be reached.
    loading.loading = new Promise(() => {});
    store.emit('workspace');
    await d.tick(10);
    expect(text()).toContain('Could not reach');
    pane.destroy();
  });
});

describe('the keyboard on a sidebar row that folds away', () => {
  /** The sidebar over #general (open) and #ops, #random, #docs (read), Channels folded, on `hash`. */
  async function sidebar(hash) {
    const ctx = await boot({ hash });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c5 = { id: 'c5', name: 'docs' };
    store.me.channels = ['c1', 'c2', 'c3', 'c5'];
    localStorage.setItem('teamchat:collapsed', JSON.stringify({ channels: true }));
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await d.tick(5);
    const row = (id) => nav.querySelector(`.side-item[href$="/c/${id}"]`);
    const shown = (id) => row(id).getClientRects().length > 0;
    return { ...ctx, nav, row, shown };
  }

  it('goes to the row that took its place rather than to the page, when the row it was on is read and no longer open', async () => {
    const { dom: d, nav, row, shown } = await sidebar(`#/ws/${encodeURIComponent(REF)}/c/c1`);
    // Folded: the open row shows alone among the channels.
    expect(shown('c1')).toBe(true);
    expect(shown('c2')).toBe(false);
    row('c1').focus();
    expect(document.activeElement).toBe(row('c1'));
    // Alt+Down, a click on another channel: #general is left, read, and folds away on the redraw.
    location.hash = `#/ws/${encodeURIComponent(REF)}/c/c2`;
    await d.tick(5);
    expect(shown('c1')).toBe(false);
    expect(shown('c2')).toBe(true);
    // The keyboard is on a row the layout shows, not on the page.
    const active = document.activeElement;
    expect(active).not.toBe(document.body);
    expect(nav.contains(active)).toBe(true);
    expect(active.getClientRects().length).toBeGreaterThan(0);
    expect(active.classList.contains('side-item')).toBe(true);
  });
});

describe('the thread panel closed from within on a touch screen', () => {
  /** The shell mounted on a thread of #general; the panel's close button, and the column's message box. */
  async function shell(env) {
    const { buildHash } = await import('../src/lib/router.js');
    const ctx = await boot({ hash: buildHash({ ws: REF, conv: 'c1', thread: 3 }), routes: { '/messages': () => json({ messages: [], seq: 0 }) }, ...env });
    const { dom: d } = ctx;
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    const close = app.querySelector('.panel-close');
    expect(close).toBeTruthy();
    const box = app.querySelector('.main textarea');
    expect(box).toBeTruthy();
    return { ...ctx, app, close, box };
  }

  it('does not hand the keyboard to the message box, which would bring the phone\'s keyboard up over the conversation', async () => {
    const { dom: d, close, box, app } = await shell({ width: 390, coarse: true, hover: false });
    // The tap focuses the button, as Chrome's does, before the click.
    close.focus();
    expect(document.activeElement).toBe(close);
    close.click();
    await d.tick(10);
    expect(app.querySelector('.panel').hidden).toBe(true);
    expect(document.activeElement).not.toBe(box);
  });

  it('hands it to the message box on a desk, as before', async () => {
    const { dom: d, close, box, app } = await shell({});
    close.focus();
    close.click();
    await d.tick(10);
    expect(app.querySelector('.panel').hidden).toBe(true);
    expect(document.activeElement).toBe(box);
  });
});

describe('the Threads view over many threads', () => {
  const root = (seq) => ({ seq, user: 'u-dan', ts: 1000 + seq, text: `root ${seq}`, kind: 'msg', replyCount: 2 });
  const threadsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `c1_t${i + 1}`, conv: 'c1', seq: i + 1, at: 5000 - i, unread: 0, root: root(i + 1) }));

  /** The view over `n` threads, every read of a thread's replies held until the test lets it go. */
  async function view(n) {
    const held = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/threads`,
      routes: {
        '/threads': () => json({ threads: threadsOf(n) }),
        '/messages': () => new Promise((resolve) => held.push(() => resolve(json({ messages: [], seq: 0 })))),
      },
    });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await ctx.dom.tick(10);
    const reads = () => ctx.calls.filter((c) => /\/conv\/c1_t\d+\/messages/.test(c));
    const loading = () => [...v.el.querySelectorAll('.thread-card')].filter((c) => c.textContent.includes('Loading replies')).length;
    const answer = (k) => { for (let i = 0; i < k && held.length; i++) held.shift()(); };
    return { ...ctx, view: v, held, reads, loading, answer };
  }

  it('reads the replies a few cards at a time, in the order the cards stand, rather than one read for every card at once', async () => {
    const { dom: d, view: v, reads, loading, answer, held } = await view(20);
    expect(v.el.querySelectorAll('.thread-card').length).toBe(20);
    // Six reads out, for the first six cards; the rest wait their turn, saying so.
    expect(reads().length).toBe(6);
    expect(reads().map((c) => /c1_t(\d+)/.exec(c)[1])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(loading()).toBe(20);
    // Two answers come: two more reads go out, the next two cards' in order.
    answer(2);
    await d.tick(10);
    expect(reads().length).toBe(8);
    expect(reads().slice(6).map((c) => /c1_t(\d+)/.exec(c)[1])).toEqual(['7', '8']);
    // Every answer comes: every card is read, once.
    for (let round = 0; round < 6; round++) {
      answer(held.length);
      await d.tick(10);
    }
    expect(reads().length).toBe(20);
    expect(new Set(reads()).size).toBe(20);
    expect(loading()).toBe(0);
    v.destroy();
  });

  it('reads nothing more for a view that has gone', async () => {
    const { dom: d, view: v, reads, answer, held } = await view(10);
    expect(reads().length).toBe(6);
    v.destroy();
    answer(held.length);
    await d.tick(10);
    expect(reads().length).toBe(6);
  });
});

describe('the worker refusing every request for want of a Puter sign-in', () => {
  /** The shell mounted over an open workspace; the toast that offers to sign in again, if any. */
  async function shell() {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { ApiError } = await import('../src/lib/api.js');
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await ctx.dom.tick(10);
    const prompt = () => [...document.querySelectorAll('.toast:not(.leaving)')].find((t) => /sign in again/i.test(t.textContent));
    return { ...ctx, ApiError, prompt };
  }

  it('says so once, with a way to sign in again, where before nothing was said at all', async () => {
    const { store, dom: d, ApiError, prompt } = await shell();
    expect(prompt()).toBeUndefined();
    // The poll answers 401, as the worker does when Puter cannot say who is asking.
    store.emit('error', new ApiError(401, 'unauthorized', 'Your Puter session is not valid'));
    expect(prompt()).toBeTruthy();
    expect(prompt().textContent).toContain('Puter could not confirm your sign-in');
    const action = prompt().querySelector('.toast-action');
    expect(action?.textContent).toBe('Sign in again');
    expect(prompt().querySelector('.toast-close')).toBeTruthy();
    // The next polls answer the same: said once, and kept until acted on.
    store.emit('error', new ApiError(401, 'unauthorized', 'Your Puter session is not valid'));
    store.emit('error', new ApiError(401, 'unauthorized', 'Your Puter session is not valid'));
    await d.tick(3000);
    expect(document.querySelectorAll('.toast:not(.leaving)').length).toBe(1);
    // Sign in again reloads the page, which leads to the sign-in page (see main.js boot).
    action.click();
    expect(location.reloads).toBe(1);
  });

  it('is not said for the network failing or the worker erroring', async () => {
    const { store, ApiError, prompt } = await shell();
    store.emit('error', new ApiError(500, 'error', 'The server is down for a moment'));
    store.emit('error', new ApiError(0, 'network', 'Failed to fetch'));
    expect(prompt()).toBeUndefined();
  });
});

describe('the top bar\'s search box when the results are left', () => {
  const empty = () => json({ results: [], cursor: null, hasMore: false, indexed: true, failed: 0 });

  it('empties, whether or not the keyboard is still in it, and the query stays among the recent searches', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/search/build`, routes: { '/search': empty, '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    const { mountShell } = await import('../src/ui/shell.js');
    const { buildHash } = await import('../src/lib/router.js');
    const { recentSearches } = await import('../src/lib/recent.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    // The results page puts the keyboard in its own box a moment after it
    // opens (a box the stylesheet hides on a desk, where this DOM has no
    // stylesheet): waited for, so the keyboard put in the top bar's box
    // below is not taken from it a moment later by that.
    const until = async (ok) => { for (let i = 0; i < 400 && !ok(); i++) await d.tick(5); expect(ok()).toBe(true); };
    await until(() => document.activeElement?.classList.contains('search-input'));
    const input = app.querySelector('.top-search-input');
    const clear = app.querySelector('.top-search-clear');
    expect(input.value).toBe('build');
    expect(clear.hidden).toBe(false);
    // A row of the sidebar pressed in a browser that leaves the keyboard in the box (Safari and Firefox on a Mac), or Alt+Down from the box.
    input.focus();
    expect(document.activeElement).toBe(input);
    location.hash = buildHash({ ws: REF, conv: 'c1' });
    await d.tick(10);
    expect(app.querySelector('.main')?.dataset.conv).toBe('c1');
    expect(input.value).toBe('');
    expect(clear.hidden).toBe(true);
    expect(recentSearches(REF)).toContain('build');
    // On any other page the box holds what is being typed, whose search has not run yet: a poll's sync leaves it.
    d.type(input, 'bu');
    store.emit('workspace');
    expect(input.value).toBe('bu');
    // Emptied before the pause that would run the search is up, so nothing is searched after the test.
    d.type(input, '');
  });
});

describe('the Sent tab of Drafts & sent', () => {
  const msg = (seq) => ({ conv: 'c1', seq, user: 'u-me', ts: 1_700_000_000_000 + seq * 1000, text: `sent number ${seq}` });
  const page1 = { results: [msg(9), msg(8)], cursor: 'p2', hasMore: true, indexed: true, failed: 0 };
  const page2 = { results: [msg(7), msg(6)], cursor: null, hasMore: false, indexed: true, failed: 0 };

  /** The Sent tab open, the worker answering `pages` by cursor. */
  async function sent(pages) {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/drafts`, routes: { '/search': (params) => pages(params.get('cursor')) } });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('drafts');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    [...view.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Sent').click();
    await ctx.dom.tick(10);
    const rows = () => view.el.querySelectorAll('.view-row').length;
    const more = (label) => [...view.el.querySelectorAll('button')].find((b) => b.textContent === label);
    return { ...ctx, view, rows, more };
  }

  it('goes on past its first page with Load more, which reads the next page and keeps the rows already there', async () => {
    const { dom: d, view, rows, more, calls } = await sent((cursor) => json(cursor ? page2 : page1));
    expect(rows()).toBe(2);
    const btn = more('Load more');
    expect(btn).toBeTruthy();
    btn.focus();
    btn.click();
    await d.tick(10);
    expect(calls.some((c) => c.includes('/search') && c.includes('cursor=p2') && c.includes('from=u-me'))).toBe(true);
    expect(rows()).toBe(4);
    expect([...view.el.querySelectorAll('.view-row-text')].map((n) => n.textContent)).toEqual(['sent number 9', 'sent number 8', 'sent number 7', 'sent number 6']);
    // The last page: nothing more to load, and the keyboard is still in the list.
    expect(more('Load more')).toBeUndefined();
    expect(view.el.contains(document.activeElement)).toBe(true);
    view.destroy();
  });

  it('keeps the rows and says so under them when the next page cannot be read, with a Try again for that page', async () => {
    let fail = true;
    const { dom: d, view, rows, more, calls } = await sent((cursor) => (cursor ? (fail ? json({ code: 'error', message: 'The server is down for a moment' }, 500) : json(page2)) : json(page1)));
    more('Load more').click();
    await d.tick(10);
    expect(rows()).toBe(2);
    expect(view.el.textContent).toContain('The server is down for a moment');
    const again = more('Try again');
    expect(again).toBeTruthy();
    fail = false;
    again.click();
    await d.tick(10);
    expect(calls.filter((c) => c.includes('cursor=p2')).length).toBe(2);
    expect(rows()).toBe(4);
    view.destroy();
  });

  it('says older months are unsearched, with the way to search them, when the first page has nothing but the index goes on', async () => {
    const { dom: d, view, rows, more } = await sent((cursor) => json(cursor ? page2 : { results: [], cursor: 'p2', hasMore: true, indexed: true, failed: 0 }));
    expect(rows()).toBe(0);
    expect(view.el.querySelector('h3').textContent).toBe('Nothing so far');
    more('Search older months').click();
    await d.tick(10);
    expect(rows()).toBe(2);
    view.destroy();
  });
});

describe('the Directory\'s filter box over many members', () => {
  it('shows and hides the cards that are there rather than building them again for every letter, and says when nothing matches', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    ctx.open();
    for (let i = 0; i < 500; i++) ctx.store.ws.members[`u${i}`] = { role: 'member', name: `Person ${i} Surname${i % 7}`, username: `p${i}`, title: i % 3 ? 'Engineer' : '' };
    for (let i = 0; i < 40; i++) ctx.store.ws.channels[`ch${i}`] = { id: `ch${i}`, name: `chan-${i}`, count: i, topic: i % 2 ? 'ops talk' : '' };
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    const search = view.el.querySelector('.dir-search');
    const cards = () => [...view.el.querySelectorAll('.dir-card')];
    const before = cards();
    expect(before.length).toBe(502);
    ctx.dom.type(search, 'person 1');
    // The cards that match are the very cards built when the Directory opened; none built anew.
    expect(cards().length).toBe(111);
    expect(cards().every((c) => before.includes(c))).toBe(true);
    // "@p7" finds the username, the sigil coming off what was typed.
    ctx.dom.type(search, '@p7');
    expect(cards().length).toBe(11);
    expect(cards().every((c) => before.includes(c) && /^Person 7\d? Surname/.test(c.querySelector('.dir-card-name').textContent))).toBe(true);
    // Nothing matches: the grid gives way to the word, and the footer with it; cleared, everything is back, the same cards in the same order.
    ctx.dom.type(search, 'zzz');
    expect(cards().length).toBe(0);
    expect(view.el.querySelector('.dir-grid').getClientRects().length).toBe(0);
    const empty = view.el.querySelector('.empty');
    expect(empty.getClientRects().length).toBe(1);
    expect(empty.querySelector('h3').textContent).toBe('Nobody matches');
    ctx.dom.type(search, '');
    expect(cards().every((c, i) => c === before[i])).toBe(true);
    expect(cards().length).toBe(502);
    expect(empty.getClientRects().length).toBe(0);
    // The Channels tab, the same: rows kept, listed by name, topic or description.
    [...view.el.querySelectorAll('[role="tab"]')][1].click();
    const rows = () => [...view.el.querySelectorAll('.dir-row')];
    const first = rows();
    expect(first.length).toBe(43);
    ctx.dom.type(search, 'ops talk');
    expect(rows().length).toBe(20);
    expect(rows().every((r) => first.includes(r))).toBe(true);
    ctx.dom.type(search, 'nothing-here');
    expect(view.el.querySelector('.empty h3').textContent).toBe('No channels match');
    // A poll that changes someone's presence rebuilds the cards, and the filter holds over the new ones.
    [...view.el.querySelectorAll('[role="tab"]')][0].click();
    ctx.dom.type(search, 'person 1');
    ctx.store.act.p = { u5: { s: 'active', at: Date.now() } };
    ctx.store.emit('activity');
    expect(cards().length).toBe(111);
    expect(cards().some((c) => before.includes(c))).toBe(false);
    view.destroy();
  });
});

describe('the mark of a workspace whose name opens with an emoji', () => {
  it('is the emoji, whole, rather than half of it', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { workspaceMark } = await import('../src/ui/avatar.js');
    const letter = (name) => workspaceMark(document.createElement('span'), { name }).querySelector('.ws-letter').textContent;
    expect(letter('🚀 Rockets')).toBe('🚀');
    expect(letter('🚀 Rockets').isWellFormed()).toBe(true);
    expect(letter('👩‍💻 Devs')).toBe('👩‍💻');
    expect(letter('globex')).toBe('G');
    expect(letter('  acme  ')).toBe('A');
    expect(letter('')).toBe('W');
    expect(letter('日本語')).toBe('日');
  });
});

describe('the done mark of a Later row on a touch screen, in the stylesheet', () => {
  // The fake DOM applies no CSS, so the contract is read from the text, as
  // the pass-15 and pass-17 files read the safe-area and busy-row rules.
  const read = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('grows its hit area to 28px under (pointer: coarse) without moving the mark', () => {
    const app = read('app.css');
    const coarse = app.lastIndexOf('@media (pointer: coarse)');
    expect(coarse).toBeGreaterThan(0);
    const block = app.slice(coarse);
    // The mark is 22px square with a pseudo-element a pixel round it (components.css); on touch that grows by three each way.
    expect(read('components.css')).toMatch(/\.view-check::after \{ content: ''; position: absolute; inset: -1px; \}/);
    expect(block).toMatch(/\.view-check::after \{ inset: -3px; \}/);
    // Nothing that would move the row: no width, height or margin on the mark itself in that block.
    expect(block).not.toMatch(/\.view-check \{[^}]*(width|height|margin)/);
  });
});

describe('the Organizations card of a shared channel whose host\'s name opens with an emoji', () => {
  const HOST = 'cccc333300@teamchat-test';

  it('shows the emoji whole as the host\'s mark, as the workspace marks do', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c4`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c4 = { id: 'c4', name: 'rockets-shared', count: 2, shared: { ref: HOST, ch: 'hc4', conn: 'k1', host: '🚀 Rockets' } };
    store.me.channels.push('c4');
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { closeAllModals } = await import('../src/ui/modal.js');
    openDetailsDialog('c4');
    await d.tick(10);
    const marks = [...document.querySelectorAll('.modal-root .org-mark')].map((n) => n.textContent);
    expect(marks.length).toBe(2);
    expect(marks[0]).toBe('🚀');
    expect(marks[0].isWellFormed()).toBe(true);
    expect(marks[1]).toBe('G');
    closeAllModals();
  });
});

describe('the sidebar\'s "Find a conversation" box over many direct messages', () => {
  /** The sidebar with `n` direct messages, each with someone called Person i. */
  async function sidebar(n) {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { store } = ctx;
    for (let i = 0; i < n; i++) {
      store.ws.members[`u${i}`] = { role: 'member', name: `Person ${i}`, username: `p${i}`, color: i % 8, avatar: 'v1' };
      store.me.dms[`dm${i}`] = { members: ['u-me', `u${i}`], createdAt: i };
    }
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await ctx.dom.tick(5);
    const box = nav.querySelector('.side-filter-input');
    const rows = () => [...nav.querySelectorAll('.side-results .side-item')];
    return { ...ctx, nav, box, rows };
  }

  it('keeps the rows already drawn for the conversations that go on matching, and draws afresh on a redraw for any other reason', async () => {
    const { store, dom: d, box, rows } = await sidebar(60);
    d.type(box, 'person');
    const first = rows();
    expect(first.length).toBe(60);
    d.type(box, 'person 1');
    const second = rows();
    expect(second.length).toBe(11); // Person 1, 10 to 19
    expect(second.every((r) => first.includes(r))).toBe(true);
    // Narrowed, then widened again: the rows that come back are the ones drawn first.
    d.type(box, 'person');
    expect(rows().every((r) => first.includes(r))).toBe(true);
    expect(rows().length).toBe(60);
    // A poll redraws the list: the rows are new, showing what the store holds now.
    store.me.reads.dm3 = 0;
    store.act.c.dm3 = { s: 2, t: 9 };
    store.emit('activity');
    await d.tick(5);
    const third = rows();
    expect(third.length).toBe(60);
    expect(third.some((r) => first.includes(r))).toBe(false);
    expect(third.find((r) => r.getAttribute('href').endsWith('/c/dm3')).classList.contains('unread')).toBe(true);
    // Channels still come before direct messages, and a channel typed with its sigil is still found.
    d.type(box, '#gen');
    expect(rows().map((r) => r.querySelector('.side-label').textContent)).toEqual(['general']);
  });
});

describe('the Direct messages list\'s box over many direct messages', () => {
  it('keeps the rows already drawn for the conversations that go on matching, and draws afresh on a redraw for any other reason', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    ctx.open();
    for (let i = 0; i < 60; i++) {
      store.ws.members[`u${i}`] = { role: 'member', name: `Person ${i}`, username: `p${i}`, color: i % 8 };
      store.me.dms[`dm${i}`] = { members: ['u-me', `u${i}`], createdAt: i };
    }
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(20);
    const box = pane.el.querySelector('.side-filter-input');
    const rows = () => [...pane.el.querySelectorAll('.pane-row')];
    d.type(box, 'person');
    const first = rows();
    expect(first.length).toBe(60);
    d.type(box, 'person 1');
    const second = rows();
    expect(second.length).toBe(11);
    expect(second.every((r) => first.includes(r))).toBe(true);
    d.type(box, '@p2');
    expect(rows().length).toBe(11); // p2, p20 to p29
    expect(rows().every((r) => first.includes(r))).toBe(true);
    // A message arriving redraws the list: the rows are new, showing what the store holds now.
    store.emit('messages', { conv: 'dm5', reason: 'newer' });
    await d.tick(5);
    const third = rows();
    expect(third.length).toBe(11);
    expect(third.some((r) => first.includes(r))).toBe(false);
    pane.destroy();
  });
});

describe('the day pill floating over the messages on a touch screen, in the stylesheet', () => {
  const read = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('is at least 28px tall under (pointer: coarse); floating, it moves nothing when it grows', () => {
    const app = read('app.css');
    const block = app.slice(app.lastIndexOf('@media (pointer: coarse)'));
    // Some 25px to the eye otherwise (4px of padding round 12.5px type inside a 1px border).
    expect(block).toMatch(/\.date-float \{[^}]*min-height: 28px/);
    expect(app).toMatch(/\.date-float \{[^}]*position: absolute/);
  });
});
