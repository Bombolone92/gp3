/**
 * Eighteenth review pass, the shell: the app frame, the sidebar and its
 * panes, the search view and the list views, driven in node through
 * tests/helpers/dom.js (a small DOM: elements, selectors, bubbling events,
 * focus with the focus fixup rule, a hash location that fires hashchange on
 * the next tick, matchMedia by viewport; no CSS). Every test boots a fresh
 * DOM and a fresh module registry. Puter is faked at `puter.workers.exec`,
 * as in tests/ui-shell-pass17.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// The search paging tests drive the real shell through the fake DOM and wait
// on its debounces; under several test runs at once (six review gates on one
// machine) a page that settles in well under a second alone ran past the
// default five seconds. Room, not a weaker check.
vi.setConfig({ testTimeout: 20_000 });
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

const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const down = () => json({ code: 'error', message: 'The server is down for a moment' }, 500);

describe('search results when the next page cannot be read', () => {
  const page1 = { results: [{ conv: 'c2', seq: 4, user: 'u-dan', ts: 1_700_000_000_000, text: 'ops one' }], cursor: 'c-2', hasMore: true, indexed: true, failed: 0 };

  /** The search view over a query whose first page came and whose second the worker refuses. */
  async function afterFailedPage() {
    let n = 0;
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/search/ops`, routes: { '/search': () => (++n === 1 ? json(page1) : down()) } });
    ctx.open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('ops', { onQuery() {} });
    document.body.append(view.el);
    await ctx.dom.tick(10);
    expect(view.el.querySelectorAll('.search-hit').length).toBe(1);
    const more = button(view.el, 'Load more results');
    expect(more).toBeTruthy();
    more.focus();
    more.click();
    await ctx.dom.tick(10);
    return { ...ctx, view };
  }

  it('keeps the hits already on screen, says the page could not be read, and offers to try that page again', async () => {
    const { view, calls } = await afterFailedPage();
    // The first page stays; the failure is said under it, not in its place.
    expect(view.el.querySelectorAll('.search-hit').length).toBe(1);
    expect([...view.el.querySelectorAll('h3')].map((h) => h.textContent)).not.toContain('Could not search');
    expect(view.el.textContent).toContain('The server is down for a moment');
    const again = button(view.el, 'Try again');
    expect(again).toBeTruthy();
    // The keyboard, which was on Load more, stays in the column on the button that took its place.
    expect(document.activeElement).toBe(again);
    // Try again asks for the page that failed, not for the first one over.
    again.click();
    await dom.tick(10);
    expect(calls.filter((c) => c.includes('/search'))).toHaveLength(3);
    expect(calls[2]).toContain('cursor=c-2');
    expect(view.el.querySelectorAll('.search-hit').length).toBe(1);
    view.destroy();
  });

  it('says so in the live region, and a fresh search clears the note', async () => {
    const { view, store } = await afterFailedPage();
    expect(view.el.querySelector('[role="status"]').textContent).toBe('Could not load more results');
    // The workspace polls on: the note stays with the results it belongs to.
    store.emit('workspace');
    await dom.tick(5);
    expect(button(view.el, 'Try again')).toBeTruthy();
    expect(view.el.querySelectorAll('.search-hit').length).toBe(1);
    // A new query starts over without the old page's failure.
    view.setQuery('ops two');
    await dom.tick(10);
    expect(button(view.el, 'Try again')).toBeTruthy(); // the search itself failed this time (every call after the first is refused)
    expect(view.el.querySelector('h3')?.textContent).toBe('Could not search');
    view.destroy();
  });
});

describe('a workspace the worker refuses (403), forgotten while the reader opens another', () => {
  const GONE = 'bbbb222200@teamchat-test';

  it('leaves the reader where they went rather than sending them home once the forgetting lands', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(GONE)}/c/x1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d } = ctx;
    const { ApiError } = await import('../src/lib/api.js');
    store.openWorkspace = async (id) => {
      if (id === GONE) throw new ApiError(403, 'forbidden', 'Not a member');
      ctx.open();
      store.emit('workspace');
    };
    let forgotten = null;
    store.forgetWorkspace = () => new Promise((r) => { forgotten = r; });
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    // Refused: said, and the workspace is being forgotten (a write to the account, still out).
    expect(document.querySelector('.toast')?.textContent).toContain('You do not have access to that workspace');
    expect(forgotten).not.toBeNull();
    // Meanwhile the reader opens another workspace, on one of its channels.
    location.hash = `#/ws/${encodeURIComponent(REF)}/c/c2`;
    await d.tick(10);
    expect(app.querySelector('.main[data-conv]')?.dataset.conv).toBe('c2');
    // The forgetting lands: they stay where they went.
    forgotten();
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c2`);
    expect(app.querySelector('.main[data-conv]')?.dataset.conv).toBe('c2');
  });
});

describe('a Later row\'s control held for its action (Done, Remove, Send now)', () => {
  /** The Later view over `n` saved items, its POST /saved held until `release()` is called. */
  async function laterHeld(n) {
    const posts = [];
    let release = null;
    const items = Array.from({ length: n }, (_, i) => ({ c: 'c1', s: i + 1, ts: 100 - i, done: false, message: { seq: i + 1, user: 'u-dan', ts: 50, text: `note ${i + 1}`, kind: 'msg' } }));
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/later`,
      routes: {
        '/saved': (q, init) => {
          if (init.method !== 'POST') return json({ items });
          posts.push(JSON.parse(init.body));
          return new Promise((r) => { release = (body, status = 200) => r(json(body, status)); });
        },
      },
    });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    return { ...ctx, view, posts, release: (...a) => release(...a) };
  }

  it('is held busy, not disabled, so the keyboard stays on it while the worker answers, and takes one press', async () => {
    const { view, dom: d, posts, release } = await laterHeld(3);
    const removes = () => [...view.el.querySelectorAll('[aria-label="Remove from Later"]')];
    const btn = removes()[1];
    btn.focus();
    btn.click();
    await d.tick(5);
    expect(posts).toHaveLength(1);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(btn);
    // A second press while the first is out sends nothing more.
    btn.click();
    await d.tick(5);
    expect(posts).toHaveLength(1);
    // The removal lands: the row goes, and the keyboard lands on the row that took its place.
    release({ ok: true });
    await d.tick(10);
    expect([...view.el.querySelectorAll('.view-row-text')].map((n) => n.textContent)).toEqual(['note 1', 'note 3']);
    expect(document.activeElement).toBe(removes()[1]);
    expect(removes()[1].getAttribute('aria-busy')).toBeNull();
    view.destroy();
  });

  it('keeps the keyboard on the mark through the wait, and on the same mark under its new name once the change lands', async () => {
    const { view, dom: d, release } = await laterHeld(3);
    const checks = () => [...view.el.querySelectorAll('.view-check')];
    checks()[1].focus();
    checks()[1].click();
    await d.tick(5);
    expect(checks()[1].getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(checks()[1]);
    release({ ok: true });
    await d.tick(10);
    expect(checks()[1].getAttribute('aria-label')).toBe('Mark not done');
    expect(checks()[1].getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(checks()[1]);
    view.destroy();
  });
});

describe('the Files view when the next page cannot be read', () => {
  const ts = 1_700_000_000_000;
  const filePage = { results: [{ conv: 'c1', seq: 3, user: 'u-dan', ts, text: '', attachments: [{ id: 'f1', name: 'plan.pdf', type: 'application/pdf', size: 1200 }] }], cursor: 'f-2', hasMore: true, indexed: true };
  const linkPage = { results: [{ conv: 'c2', seq: 5, user: 'u-dan', ts: ts - 1000, text: 'see https://example.com/a' }], cursor: 'l-2', hasMore: true, indexed: true };

  /** The Files page over a first page that came and a second the worker refuses. */
  async function afterFailedPage() {
    let n = 0;
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/files`, routes: { '/search': (params) => (++n <= 2 ? json(params.get('has') === 'file' ? filePage : linkPage) : down()) } });
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const view = createFilesPage();
    document.body.append(view.el);
    await ctx.dom.tick(10);
    expect(view.el.querySelectorAll('.files-row').length).toBe(2);
    const more = button(view.el, 'Load older files and links');
    expect(more).toBeTruthy();
    more.focus();
    more.click();
    await ctx.dom.tick(10);
    return { ...ctx, view };
  }

  it('keeps the rows already on screen, says the page could not be read, and offers to try that page again', async () => {
    const { view, calls } = await afterFailedPage();
    expect(view.el.querySelectorAll('.files-row').length).toBe(2);
    expect([...view.el.querySelectorAll('h3')].map((h) => h.textContent)).not.toContain('Could not load files and links');
    expect(view.el.textContent).toContain('The server is down for a moment');
    const again = button(view.el, 'Try again');
    expect(again).toBeTruthy();
    expect(document.activeElement).toBe(again);
    again.click();
    await dom.tick(10);
    // The two reads (files, links) asked again for the page that failed, not for the first over.
    const searches = calls.filter((c) => c.includes('/search'));
    expect(searches).toHaveLength(6);
    expect(searches.slice(4).some((c) => c.includes('cursor=f-2'))).toBe(true);
    expect(searches.slice(4).some((c) => c.includes('cursor=l-2'))).toBe(true);
    expect(view.el.querySelectorAll('.files-row').length).toBe(2);
    view.destroy();
  });
});

describe('the shortcuts panel against the keys the app binds', () => {
  it('lists sending a message and the new line by the Enter preference, and the key that opens a row\'s menu', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { shortcutGroups, SHORTCUT_GROUPS, renderShortcutsPanel } = await import('../src/ui/shortcuts.js');
    const rows = (title) => shortcutGroups().find(([t]) => t.startsWith(title))[1].map(([what, keys]) => [what, keys.join('+')]);
    // Enter sends (the default on a desk, the fake navigator being a Mac): Send is Enter, a new line Shift+Enter.
    expect(rows('Formatting')).toContainEqual(['Send message', 'Enter']);
    expect(rows('Formatting')).toContainEqual(['New line', '⇧+Enter']);
    // Enter for a new line (the preference off): Send is Cmd+Enter, a new line Enter.
    ctx.store.profile.prefs.enterSends = false;
    expect(rows('Formatting')).toContainEqual(['Send message', '⌘+Enter']);
    expect(rows('Formatting')).toContainEqual(['New line', 'Enter']);
    expect(rows('Formatting')).not.toContainEqual(['New line', '⇧+Enter']);
    // The sidebar rows' menu, opened from the keyboard.
    expect(rows('Navigation').some(([what, keys]) => /menu/i.test(what) && keys === '⇧+F10')).toBe(true);
    // The static list keeps its shape for the message keys.
    expect(SHORTCUT_GROUPS.find(([t]) => /^Messages/.test(t))[1].slice(0, 4).map(([, k]) => k.join('+'))).toEqual(['↑', '↓', 'Home', 'End']);
    // The panel is drawn from the list as it stands when it opens.
    const panel = document.createElement('aside');
    document.body.append(panel);
    renderShortcutsPanel(panel, { onClose() {} });
    const what = [...panel.querySelectorAll('.shortcut-what')].map((n) => n.textContent);
    expect(what).toContain('Send message');
    const send = [...panel.querySelectorAll('.shortcut-row')].find((r) => r.querySelector('.shortcut-what').textContent === 'Send message');
    expect([...send.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘', 'Enter']);
  });
});

describe('a toast\'s buttons pressed from the keyboard', () => {
  it('hand the keyboard back to where it was when the toast came, rather than leaving it on the page', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { toast } = await import('../src/ui/toast.js');
    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    let undone = 0;
    toast('Removed from Later', { action: { label: 'Undo', onClick: () => { undone++; } } });
    const undo = document.querySelector('.toast-action');
    undo.focus();
    expect(document.activeElement).toBe(undo);
    undo.click();
    expect(undone).toBe(1);
    // The toast leaves (this DOM fires no animationend: the fallback takes it away).
    await ctx.dom.tick(450);
    expect(document.querySelector('.toast')).toBeNull();
    expect(document.activeElement).toBe(box);
    // Dismiss on a toast kept until acted on, the same.
    toast('A new version of Teamchat is ready', { duration: Infinity, dismissible: true, action: { label: 'Reload', onClick() {} } });
    const close = document.querySelector('.toast-close');
    close.focus();
    close.click();
    await ctx.dom.tick(450);
    expect(document.querySelector('.toast')).toBeNull();
    expect(document.activeElement).toBe(box);
    // Pressed with a pointer (the keyboard elsewhere), nothing moves.
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    toast('Forwarded', { action: { label: 'Open', onClick() {} } });
    document.querySelector('.toast-action').click();
    await ctx.dom.tick(450);
    expect(document.activeElement).toBe(other);
  });
});

describe('search filters naming someone who has left the workspace', () => {
  it('resolve from:@them and in:@them through the former members (the worker filters by uuid), and the hits say they left', async () => {
    const ts = 1_700_000_000_000;
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/search/hello`,
      routes: { '/search': () => json({ results: [{ conv: 'dm_old', seq: 2, user: 'u-old', ts, text: 'hello there' }], cursor: null, hasMore: false, indexed: true, failed: 0 }) },
    });
    const { store, dom: d, calls } = ctx;
    ctx.open();
    store.ws.former = { 'u-old': { name: 'Old Timer', username: 'old', color: 2, at: ts } };
    store.me.dms.dm_old = { members: ['u-me', 'u-old'], createdAt: 4 };
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('from:@old hello', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(10);
    expect(view.el.textContent).not.toContain('Nobody here is called');
    expect(calls.some((c) => c.includes('/search') && c.includes('from=u-old'))).toBe(true);
    const hit = view.el.querySelector('.search-hit');
    expect(hit).toBeTruthy();
    expect(hit.textContent).toContain('Old Timer');
    expect(hit.textContent).toContain('(left)');
    expect(hit.getAttribute('aria-label')).toContain('Old Timer (left the workspace)');
    // The direct message still held with them.
    view.setQuery('in:@old hello');
    await d.tick(10);
    expect(calls.some((c) => c.includes('/search') && c.includes('in=dm_old'))).toBe(true);
    // Someone still here comes first under a name that was theirs, and a name nobody ever had is still refused.
    store.ws.members['u-new'] = { role: 'member', name: 'New Old', username: 'old' };
    view.setQuery('from:@old bye');
    await d.tick(10);
    expect(calls.some((c) => c.includes('/search') && c.includes('from=u-new'))).toBe(true);
    view.setQuery('from:@nobody hello');
    await d.tick(10);
    expect(view.el.textContent).toContain('Nobody here is called @nobody');
    // A hit by someone still here carries no such mark.
    expect([...view.el.querySelectorAll('.search-hit-left')].length).toBe(0);
    view.destroy();
  });
});

describe('a folded sidebar section', () => {
  /** The sidebar over #general (open, read), #ops (unread), #random (read, two mentions) and #docs (read), on `hash`. */
  async function sidebar(hash) {
    const ctx = await boot({ hash });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c5 = { id: 'c5', name: 'docs' };
    store.me.channels = ['c1', 'c2', 'c3', 'c5'];
    store.act.c = { c2: { s: 3, t: 1 }, c3: { s: 4, t: 1 } };
    store.me.reads = { c3: 4 };
    store.me.mentions = { c3: 2 };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await d.tick(5);
    const row = (id) => nav.querySelector(`.side-item[href$="/c/${id}"]`);
    const shown = (id) => row(id).getClientRects().length > 0;
    return { ...ctx, nav, row, shown, toggle: () => nav.querySelector('.side-title[aria-controls="side-channels"]') };
  }

  it('keeps showing its unread rows, the ones with a mention badge and the open one, folds the read ones away, and is remembered', async () => {
    const { store, dom: d, nav, row, shown, toggle } = await sidebar(`#/ws/${encodeURIComponent(REF)}/c/c1`);
    expect(['c1', 'c2', 'c3', 'c5'].every(shown)).toBe(true);
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(shown('c1')).toBe(true); // open
    expect(shown('c2')).toBe(true); // unread
    expect(shown('c3')).toBe(true); // a mention badge, though read
    expect(shown('c5')).toBe(false); // read: folded away
    expect(nav.querySelector('#side-channels + *').hidden).toBe(true); // the add row too
    // The poll redraws the list: the fold, remembered on the device, holds.
    store.emit('activity');
    await d.tick(5);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(shown('c5')).toBe(false);
    expect(shown('c2')).toBe(true);
    // Alt+Down steps through every row of the section, folded or not: the one stepped into is open, and shows.
    const stepping = [...nav.querySelectorAll('.side-row > .side-item[href]:not(.archived)')].map((a) => a.getAttribute('href'));
    expect(stepping.some((h) => h.endsWith('/c/c5'))).toBe(true);
    location.hash = `#/ws/${encodeURIComponent(REF)}/c/c5`;
    await d.tick(5);
    expect(shown('c5')).toBe(true);
    expect(row('c5').getAttribute('aria-current')).toBe('page');
    expect(shown('c1')).toBe(false); // read, and no longer open
    // Unfolded: everything is back.
    toggle().click();
    expect(['c1', 'c2', 'c3', 'c5'].every(shown)).toBe(true);
  });

  it('is left out of the filter, which lists every match', async () => {
    const { dom: d, nav, toggle } = await sidebar(`#/ws/${encodeURIComponent(REF)}/c/c1`);
    toggle().click();
    d.type(nav.querySelector('.side-filter-input'), 'doc');
    const matches = [...nav.querySelectorAll('.side-results .side-item')];
    expect(matches.map((a) => a.textContent.trim())).toEqual(['docs']);
    expect(matches[0].getClientRects().length).toBe(1);
    // Cleared, the folded list is back as it was.
    d.type(nav.querySelector('.side-filter-input'), '');
    expect(nav.querySelector('.side-item[href$="/c/c5"]').getClientRects().length).toBe(0);
    expect(nav.querySelector('.side-item[href$="/c/c2"]').getClientRects().length).toBe(1);
  });
});

describe('naming a sidebar section', () => {
  const sections = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Section ${i + 1}`, items: [] }));
  /** The dialog open; what it shows, and a way to submit a name. */
  async function open(ctx, opts) {
    const { sectionNameDialog } = await import('../src/ui/dialogs.js');
    const answer = sectionNameDialog(opts);
    await ctx.dom.tick(5);
    // The newest dialog: one closed a moment ago is still on the page while it leaves.
    const modal = [...document.querySelectorAll('.modal-root:not(.closing)')].pop();
    const input = modal.querySelector('input');
    const submit = (name) => { input.value = name; modal.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); };
    const error = () => modal.querySelector('.field-error');
    const cancel = () => [...modal.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    return { answer, modal, input, submit, error, cancel };
  }

  it('refuses a twenty-first section, saying so as the dialog opens', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    ctx.store.profile.prefs.sections = { [REF]: sections(20) };
    const { answer, error, submit, cancel } = await open(ctx);
    expect(error().hidden).toBe(false);
    expect(error().textContent).toBe('You have 20 sections, the most there can be. Delete one to make room.');
    submit('Another');
    await ctx.dom.tick(5);
    expect(document.querySelector('.modal-root')).not.toBeNull(); // not taken
    cancel();
    await ctx.dom.tick(5);
    expect(await answer).toBeNull();
    // Renaming one of the twenty is not a new section, and goes through.
    const rename = await open(ctx, { title: 'Rename section', initial: 'Section 3', confirmLabel: 'Save', rename: true });
    expect(rename.error().hidden).toBe(true);
    rename.submit('Third');
    await ctx.dom.tick(5);
    expect(await rename.answer).toBe('Third');
  });

  it('refuses the name of another section however it is cased, and lets a rename keep its own name', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    ctx.store.profile.prefs.sections = { [REF]: [{ id: 'a', name: 'Projects', items: [] }, { id: 'b', name: 'Reading', items: [] }] };
    const { answer, error, submit } = await open(ctx);
    submit('projects');
    await ctx.dom.tick(5);
    expect(error().hidden).toBe(false);
    expect(error().textContent).toBe('There is already a section called “Projects”');
    expect(document.querySelector('.modal-root')).not.toBeNull();
    submit('Customers');
    await ctx.dom.tick(5);
    expect(await answer).toBe('Customers');
    // A rename: its own name in another case passes; another section's does not.
    const same = await open(ctx, { title: 'Rename section', initial: 'Projects', confirmLabel: 'Save', rename: true });
    same.submit('PROJECTS');
    await ctx.dom.tick(5);
    expect(await same.answer).toBe('PROJECTS');
    const clash = await open(ctx, { title: 'Rename section', initial: 'Projects', confirmLabel: 'Save', rename: true });
    clash.submit('reading');
    await ctx.dom.tick(5);
    expect(clash.error().textContent).toBe('There is already a section called “Reading”');
    clash.cancel();
    await ctx.dom.tick(5);
    expect(await clash.answer).toBeNull();
  });
});

describe('controls shown only under the pointer, on a touch screen (the stylesheet)', () => {
  // The fake DOM applies no CSS: the contract is read from the text, as the
  // pass-15 and pass-17 files read the pill and the busy row.
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const css = read('styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = (sel) => sel.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
  const bodies = (text, sel) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => names(r[1]).includes(sel)).map((r) => r[2].replace(/\s+/g, ' ').trim());
  /** The bodies of every rule for `sel` inside a @media block that speaks of touch (hover: none, pointer: coarse). */
  function touch(sel) {
    const out = [];
    const re = /@media\s*([^{]+)\{/g;
    let m;
    while ((m = re.exec(css))) {
      if (!/hover: none|pointer: coarse/.test(m[1])) continue;
      let depth = 1;
      let i = re.lastIndex;
      for (; i < css.length && depth; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
      }
      out.push(...bodies(css.slice(re.lastIndex, i - 1), sel));
    }
    return out;
  }

  it('shows each one outright there, or hides it where a long press on the row opens the same menu', () => {
    // Out of sight by opacity until the pointer arrives; shown outright on touch.
    for (const sel of ['.top-drop-x', '.files-row .icon-btn-sm', '.code-copy', '.unfurl-remove']) {
      expect(bodies(css, sel).join(' '), sel).toContain('opacity: 0');
      expect(touch(sel).some((b) => /opacity: 1/.test(b)), sel).toBe(true);
    }
    // The Later card's pill: static under the card on touch, shown and taking presses.
    expect(bodies(css, '.later-actions').join(' ')).toContain('opacity: 0');
    expect(touch('.later-actions').some((b) => /opacity: 1/.test(b) && /pointer-events: auto/.test(b))).toBe(true);
    // The sidebar row's kebab and the message toolbar are hidden on touch, where a long press on the row opens the same menu.
    expect(touch('.side-kebab').some((b) => /display: none/.test(b))).toBe(true);
    expect(read('ui/sidebar.js')).toMatch(/attachLongPress\(link, openAt/);
    expect(touch('.msg-actions').some((b) => /display: none/.test(b))).toBe(true);
    expect(read('ui/message.js')).toMatch(/attachLongPress\(row/);
    // Never hidden in the first place: the chevron on a search hit, the pinned bar's toggle.
    for (const sel of ['.search-hit-go', '.pin-bar-toggle']) expect(bodies(css, sel).join(' '), sel).not.toMatch(/opacity: 0|display: none|visibility: hidden/);
  });
});

describe('the recent searches under the top bar\'s box and the Tab key', () => {
  it('close when Tab leaves the box, so the key moves on rather than through every row; inside the list Tab moves as before', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { dom: d } = ctx;
    const { noteSearch } = await import('../src/lib/recent.js');
    for (const q of ['alpha', 'beta', 'gamma']) noteSearch(REF, q);
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(10);
    const input = app.querySelector('.top-search-input');
    const drop = app.querySelector('.top-search-drop');
    input.focus();
    expect(drop.hidden).toBe(false);
    expect(drop.querySelectorAll('button').length).toBeGreaterThan(4); // Search in #general, Clear, three rows with their Forget
    // Tab from the box: the list goes, and the key is left to the browser to move on with.
    const tab = d.key(input, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(drop.hidden).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    // Back in the box the list is offered again; the down arrow goes into it, and Tab there moves within it.
    input.blur();
    input.focus();
    expect(drop.hidden).toBe(false);
    d.key(input, 'ArrowDown');
    expect(drop.contains(document.activeElement)).toBe(true);
    d.key(document.activeElement, 'Tab');
    expect(drop.hidden).toBe(false);
    // Shift+Tab from the box, the same: nothing of the list stands in the way back.
    input.focus();
    expect(drop.hidden).toBe(false);
    d.key(input, 'Tab', { shiftKey: true });
    expect(drop.hidden).toBe(true);
  });
});

describe('the Direct messages list and a conversation on a host out of reach', () => {
  const HOST = 'cccc333300@teamchat-test';
  const link = (patch) => ({ ref: HOST, ws: null, me: null, act: null, since: 0, convs: new Map(), loaded: false, loading: null, syncing: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {}, ...patch });

  it('does not read its last line while the host is down, draws the row from what is held, and reads it once the host answers', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { store, dom: d, calls } = ctx;
    ctx.open();
    store.links.set(HOST, link({ loaded: false }));
    store.me.dms.h_hc9 = { members: ['u-me', 'u-ext'], host: HOST, createdAt: 5 };
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(10);
    // The local conversation is read for its last line as before; the one on the host is not.
    expect(calls.some((c) => c.includes('/conv/dm_d/messages'))).toBe(true);
    expect(calls.some((c) => c.includes('/conv/hc9/messages'))).toBe(false);
    const row = () => [...pane.el.querySelectorAll('.pane-row')].find((r) => r.getAttribute('href').includes('h_hc9'));
    expect(row()).toBeTruthy();
    expect(row().querySelector('.pane-row-text').textContent).toContain('Could not reach');
    expect(row().querySelector('.pane-row-text').textContent).not.toContain('No messages yet');
    expect(store.conv('h_hc9').loading).toBeFalsy();
    // The host answers (its link stands loaded) and the poll redraws the list: the line is read now.
    store.links.set(HOST, link({ loaded: true, ws: { name: 'Acme', members: {}, channels: {} }, me: { channels: [], dms: {} } }));
    store.emit('activity');
    await d.tick(10);
    expect(calls.some((c) => c.includes('/conv/hc9/messages'))).toBe(true);
    pane.destroy();
  });
});

describe('the Directory\'s Channels tab and a shared channel whose connection is over', () => {
  const HOST = 'cccc333300@teamchat-test';

  it('marks a joined one as no longer shared, as the sidebar\'s row does', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c4 = { id: 'c4', name: 'shared-x', shared: { ref: HOST, ch: 'hc4', host: 'Acme' }, lost: true, count: 3 };
    store.me.channels.push('c4');
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('[role="tab"]')[1].click();
    const row = [...view.el.querySelectorAll('.dir-row')].find((r) => r.textContent.includes('shared-x'));
    expect(row).toBeTruthy();
    expect([...row.querySelectorAll('.pill')].map((p) => p.textContent)).toContain('No longer shared');
    expect(row.querySelector('.dir-row-main').getAttribute('aria-label')).toBe('#shared-x, no longer shared, details');
    // A live shared channel is not so marked.
    store.ws.channels.c4.lost = false;
    view.el.querySelectorAll('[role="tab"]')[0].click();
    view.el.querySelectorAll('[role="tab"]')[1].click();
    const live = [...view.el.querySelectorAll('.dir-row')].find((r) => r.textContent.includes('shared-x'));
    expect([...live.querySelectorAll('.pill')].map((p) => p.textContent)).not.toContain('No longer shared');
    view.destroy();
  });
});

