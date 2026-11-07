/**
 * Twelfth review pass, the shell: the sidebar, the top bar, the rail, the
 * shortcuts and the list views, driven in node through tests/helpers/dom.js
 * (a small DOM: elements, selectors, bubbling events, focus, a hash location
 * that fires hashchange on the next tick, matchMedia by viewport). Every
 * test boots a fresh DOM and a fresh module registry, so the listeners the
 * shell hangs on window and document never outlive their test. Puter is
 * faked at `puter.workers.exec`, as in tests/store.test.js; the conversation
 * column and the huddle window are stubbed (their own tests cover them).
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
        c3: { id: 'c3', name: 'zeta' },
      },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-jose': { role: 'member', name: 'José Álvarez', username: 'jose' },
        'u-hanna': { role: 'member', name: 'Hanna Müller', username: 'hmueller' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
      },
    };
    store.me = {
      role: 'member', channels: ['c1', 'c2', 'c3'],
      dms: { dm_h: { members: ['u-me', 'u-hanna'], createdAt: 5 }, dm_d: { members: ['u-me', 'u-dan'], createdAt: 3 } },
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

describe('finding people and conversations by name', () => {
  it('the sidebar filter finds José and Müller from what is typed without the accents', async () => {
    const { store, open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    open();
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const root = document.createElement('nav');
    document.body.append(root);
    renderSidebar(root);
    const labels = () => [...root.querySelectorAll('.side-item .side-label')].map((n) => n.textContent);
    const input = root.querySelector('.side-filter-input');
    d.type(input, 'muller');
    expect(labels()).toEqual(['Hanna Müller']); // her direct message
    d.type(input, 'jose');
    expect(labels()).toEqual(['José Álvarez']); // no conversation yet: a person to start one with
    d.type(input, 'Müller');
    expect(labels()).toEqual(['Hanna Müller']); // typed with the accent still finds her
    d.type(input, 'zeta');
    expect(labels()).toEqual(['zeta']);
    expect(store.wsId).toBe(REF);
  });

  it('the sidebar filter shows the same counts on its rows as the full list does', async () => {
    const { store, open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    open();
    store.act.c = { c2: { s: 5, t: 1 }, dm_h: { s: 2, t: 2 } };
    store.me.mentions = { c2: 3 };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const root = document.createElement('nav');
    document.body.append(root);
    renderSidebar(root);
    const badgeOf = (label) => [...root.querySelectorAll('.side-item')].find((n) => n.querySelector('.side-label')?.textContent === label)?.querySelector('.badge')?.textContent ?? null;
    expect(badgeOf('ops')).toBe('3');
    expect(badgeOf('Hanna Müller')).toBe('2');
    const input = root.querySelector('.side-filter-input');
    d.type(input, 'ops');
    expect(root.querySelector('.side-item').getAttribute('aria-label')).toBe('ops, 3 mentions');
    expect(badgeOf('ops')).toBe('3');
    d.type(input, 'hanna');
    expect(root.querySelector('.side-item').getAttribute('aria-label')).toBe('Hanna Müller, 2 unread');
    expect(badgeOf('Hanna Müller')).toBe('2');
  });

  it('the DMs pane filter does too', async () => {
    const { open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms` });
    open();
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    const titles = () => [...pane.el.querySelectorAll('.pane-row strong')].map((n) => n.textContent);
    expect(titles()).toEqual(['Hanna Müller', 'Dan Ito']);
    d.type(pane.el.querySelector('.side-filter-input'), 'muller');
    expect(titles()).toEqual(['Hanna Müller']);
    pane.destroy();
  });

  it('the Files filter does too', async () => {
    const file = { id: 'f1', name: 'Résumé.pdf', type: 'application/pdf', size: 1200 };
    const { open, dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (q) => json(q.get('has') === 'file'
          ? { results: [{ conv: 'c1', seq: 3, ts: 1000, user: 'u-dan', text: '', attachments: [file] }], indexed: true }
          : { results: [], indexed: true }),
      },
    });
    open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await d.tick(5);
    const names = () => [...page.el.querySelectorAll('.files-text strong')].map((n) => n.textContent);
    expect(names()).toEqual(['Résumé.pdf']);
    d.type(page.el.querySelector('.files-search'), 'resume');
    expect(names()).toEqual(['Résumé.pdf']);
    d.type(page.el.querySelector('.files-search'), 'budget');
    expect(names()).toEqual([]);
    page.destroy();
  });

  it('the Directory search does too', async () => {
    const { open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    open();
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    const names = () => [...view.el.querySelectorAll('.dir-card-name')].map((n) => n.textContent);
    expect(names()).toEqual(['Dan Ito', 'Hanna Müller', 'José Álvarez', 'Me (you)']);
    d.type(view.el.querySelector('.dir-search'), 'alvarez');
    expect(names()).toEqual(['José Álvarez']);
    view.destroy();
  });
});

describe('the Later view', () => {
  const saved = (done) => ({ c: 'c1', s: done ? 1 : 2, ts: done ? 100 : 90, done, message: { seq: done ? 1 : 2, user: 'u-dan', ts: 50, text: done ? 'old note' : 'open note', kind: 'msg' } });

  async function later(items) {
    const posts = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/later`,
      routes: {
        '/saved': (q, init) => {
          if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return json({ ok: true }); }
          return json({ items });
        },
      },
    });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    return { ...ctx, view, posts };
  }

  it('keeps the sidebar badge at the number of items not yet done after a done one is removed', async () => {
    const { store, view, dom: d, posts } = await later([saved(true), saved(false)]);
    expect(store.savedCount()).toBe(1); // the badge counts what is not done
    const rows = view.el.querySelectorAll('.later-row');
    expect(rows.length).toBe(2);
    expect(rows[0].classList.contains('done')).toBe(true);
    rows[0].querySelector('[aria-label="Remove from Later"]').click();
    await d.tick(5);
    expect(posts).toEqual([{ conv: 'c1', seq: 1, remove: true }]);
    expect(view.el.querySelectorAll('.later-row').length).toBe(1);
    // The one left is not done: the badge still says so.
    expect(store.savedCount()).toBe(1);
  });
});

describe('stepping through conversations with Alt+↑/↓', () => {
  it('follows the sidebar as the reader arranged it: a section on top, then Channels, then Direct messages', async () => {
    const { store, open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c3` });
    open();
    // #zeta sits alone in a section of the reader's own, above Channels.
    store.profile.prefs.sections = { [REF]: [{ id: 's1', name: 'Team', items: ['c3'] }] };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const { installShortcuts } = await import('../src/ui/shortcuts.js');
    const sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    const home = document.createElement('div');
    home.className = 'sidebar-home';
    sidebar.append(home);
    document.body.append(sidebar);
    renderSidebar(home);
    const convOf = (a) => decodeURIComponent(a.getAttribute('href').split('/c/')[1]);
    expect([...home.querySelectorAll('.side-row > .side-item')].map(convOf)).toEqual(['c3', 'c1', 'c2', 'dm_h', 'dm_d']);
    installShortcuts({ toggleShortcuts() {}, closePanel() {} });
    const conv = () => decodeURIComponent(location.hash.split('/c/')[1]);
    d.key(document.body, 'ArrowDown', { altKey: true });
    await d.tick(5);
    expect(conv()).toBe('c1'); // the row under #zeta is #general, the first of Channels
    d.key(document.body, 'ArrowUp', { altKey: true });
    await d.tick(5);
    expect(conv()).toBe('c3');
    d.key(document.body, 'ArrowUp', { altKey: true });
    await d.tick(5);
    expect(conv()).toBe('dm_d'); // wraps to the last row
  });
});

describe('keeping the keyboard through a redraw', () => {
  const row = (label) => {
    const r = document.createElement('div');
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    r.append(b);
    return r;
  };

  it('stays on the control whose label the press changed rather than jumping to the next row with the old label', async () => {
    await boot();
    const { keepFocus } = await import('../src/ui/dom.js');
    const list = document.createElement('div');
    document.body.append(list);
    list.replaceChildren(row('Mark done'), row('Mark done'), row('Mark done'));
    list.children[1].firstChild.focus();
    // The middle item is marked done: its own control now reads "Mark not done".
    keepFocus(list, () => list.replaceChildren(row('Mark done'), row('Mark not done'), row('Mark done')));
    expect(document.activeElement).toBe(list.children[1].firstChild);
  });

  it('still finds a control that names one thing when it moved', async () => {
    await boot();
    const { keepFocus } = await import('../src/ui/dom.js');
    const list = document.createElement('div');
    document.body.append(list);
    list.replaceChildren(row('Move Docs up'), row('Move Wiki up'));
    list.children[1].firstChild.focus();
    // Wiki moved up: its own button is first now.
    keepFocus(list, () => list.replaceChildren(row('Move Wiki up'), row('Move Docs up')));
    expect(document.activeElement).toBe(list.children[0].firstChild);
    // A row that went: the control at the same place takes the keyboard.
    list.replaceChildren(row('Remove'), row('Remove'), row('Remove'));
    list.children[1].firstChild.focus();
    keepFocus(list, () => list.replaceChildren(row('Remove'), row('Remove')));
    expect(document.activeElement).toBe(list.children[1].firstChild);
  });

  async function laterOpen(n, { fail = false } = {}) {
    const posts = [];
    const items = Array.from({ length: n }, (_, i) => ({ c: 'c1', s: i + 1, ts: 100 - i, done: false, message: { seq: i + 1, user: 'u-dan', ts: 50, text: `note ${i + 1}`, kind: 'msg' } }));
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/later`,
      routes: { '/saved': (q, init) => { if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return fail ? json({ code: 'nope', message: 'The server said no' }, 500) : json({ ok: true }); } return json({ items }); } },
    });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    return { ...ctx, view, posts };
  }

  it('keeps the same checkbox in the Later view after marking an item done with it', async () => {
    const { view, dom: d, posts } = await laterOpen(3);
    const checks = () => [...view.el.querySelectorAll('.view-check')];
    checks()[1].focus();
    checks()[1].click();
    await d.tick(5);
    expect(posts).toEqual([{ conv: 'c1', seq: 2, done: true }]);
    expect(checks()[1].getAttribute('aria-label')).toBe('Mark not done');
    expect(document.activeElement).toBe(checks()[1]);
    view.destroy();
  });

  it('hands the keyboard to the row that took a removed one\'s place, and gives it back when the removal fails', async () => {
    const { view, dom: d } = await laterOpen(3);
    const removes = () => [...view.el.querySelectorAll('[aria-label="Remove from Later"]')];
    const texts = () => [...view.el.querySelectorAll('.view-row-text')].map((n) => n.textContent);
    removes()[1].focus();
    removes()[1].click();
    await d.tick(5);
    expect(texts()).toEqual(['note 1', 'note 3']);
    expect(document.activeElement).toBe(removes()[1]); // note 3's Remove, where note 2's stood
    view.destroy();

    const failing = await laterOpen(2, { fail: true });
    const btn = failing.view.el.querySelectorAll('[aria-label="Remove from Later"]')[1];
    btn.focus();
    btn.click();
    // Held busy (not disabled) while the worker answers: the keyboard stays
    // on the button through the wait, and after the refusal.
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    await failing.dom.tick(5);
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(btn);
    failing.view.destroy();
  });
});

describe('Escape in a filter box', () => {
  it('clears the words in the shortcuts search rather than closing the panel under them; empty, it closes the panel', async () => {
    const { app, dom: d } = await shell();
    d.key(document.body, '/', { metaKey: true }); // Cmd+/ on a Mac
    await d.tick(5);
    const search = app.querySelector('.shortcuts-search');
    expect(search).not.toBeNull();
    search.focus();
    d.type(search, 'thread');
    expect([...app.querySelectorAll('.shortcut-what')].map((n) => n.textContent)).toEqual(['Threads', 'Reply in thread']);
    d.key(search, 'Escape');
    expect(app.querySelector('.shortcuts-search')).toBe(search); // still open
    expect(search.value).toBe('');
    expect(app.querySelectorAll('.shortcut-what').length).toBeGreaterThan(20); // the whole list again
    d.key(search, 'Escape');
    await d.tick(5);
    expect(app.querySelector('.shortcuts-search')).toBeNull();
  });

  it('clears the DMs pane filter and keeps the key from the page', async () => {
    const { open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms` });
    open();
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    const filter = pane.el.querySelector('.side-filter-input');
    d.type(filter, 'dan');
    expect(pane.el.querySelectorAll('.pane-row').length).toBe(1);
    expect(d.key(filter, 'Escape').defaultPrevented).toBe(true);
    expect(filter.value).toBe('');
    expect(pane.el.querySelectorAll('.pane-row').length).toBe(2);
    expect(d.key(filter, 'Escape').defaultPrevented).toBe(false); // empty: the key goes on
    pane.destroy();
  });
});

describe('the sidebar view rows', () => {
  it('say what their badges count: Later by kind, Threads as replies, Drafts as unsent', async () => {
    const { store, open } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    open();
    store._savedCount = 2;
    store._reminderCount = 1;
    store._scheduledCount = 3;
    store.me.threads = { c1_t4: 2, c2_t9: 3 };
    store.me.inbox = 1;
    const { setDraft, draftKey } = await import('../src/lib/drafts.js');
    setDraft(draftKey(REF, 'c2'), { text: 'half a thought' });
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const root = document.createElement('nav');
    document.body.append(root);
    renderSidebar(root);
    const rows = [...root.querySelectorAll('.side-views .side-item')];
    expect(rows.map((n) => n.getAttribute('aria-label'))).toEqual([
      'Threads, 5 new replies', 'Activity, 1 new', 'Later, 2 saved, 1 reminder, 3 scheduled', 'Drafts & sent, 1 unsent', 'Directory',
    ]);
    expect(rows.map((n) => n.querySelector('.badge')?.textContent ?? null)).toEqual(['5', '1', '6', '1', null]);
    // Only what there is: a Later badge of saved items alone says so.
    store._reminderCount = 0;
    store._scheduledCount = 0;
    store.emit('activity');
    await new Promise((r) => queueMicrotask(r));
    expect(root.querySelector('.side-views .side-item[href$="/later"]').getAttribute('aria-label')).toBe('Later, 2 saved');
  });
});

describe('following an invite link', () => {
  /** The shell at a join link, with the worker's answer given; what the toast says and where the reader lands. */
  async function joined(res) {
    const ctx = await boot({ hash: '#/join/teamchat-test/ABCD-EFGH-JKLM' });
    const calls = [];
    ctx.store.join = async (server, code) => { calls.push([server, code]); ctx.open(); return res; };
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await ctx.dom.tick(10);
    return { calls, toast: document.querySelector('.toast')?.textContent ?? null, hash: location.hash };
  }
  const ws = { id: REF, name: 'Globex' };

  it('tells someone already in the shared channel that they are in the channel, not in the workspace', async () => {
    const r = await joined({ already: true, channel: { id: 'c2', name: 'ops' }, workspace: ws });
    expect(r.calls).toEqual([['teamchat-test', 'ABCD-EFGH-JKLM']]);
    expect(r.toast).toBe('You are already in #ops on Globex');
    expect(r.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c2`);
  });

  it('keeps the other answers: put into the channel, or already a member of the workspace', async () => {
    expect((await joined({ already: true, joined: true, channel: { id: 'c2', name: 'ops' }, workspace: ws })).toast).toBe('You are now in #ops on Globex');
    const plain = await joined({ already: true, workspace: ws });
    expect(plain.toast).toBe('You are already in Globex');
    expect(plain.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c1`); // the workspace opens on its first channel
  });
});

describe('the search view with a filter that names nothing', () => {
  it('says to check the filter, announces it, keeps its tabs, and says "nothing to search yet" only when there are no words', async () => {
    const { open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/search/${encodeURIComponent('from:@zed hello')}` });
    open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('from:@zed hello', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(5);
    expect(view.el.querySelector('.search-body h3').textContent).toBe('Check the filter');
    expect(view.el.querySelector('.search-body .empty p').textContent).toBe('Nobody here is called @zed');
    expect(view.el.querySelector('[role="status"]').textContent).toBe('Nobody here is called @zed');
    expect(view.el.querySelector('.search-end')).toBeNull(); // no count for a search that did not run
    const tabs = view.el.querySelectorAll('.conv-tab');
    expect(tabs.length).toBe(4);
    expect(view.el.querySelector('.search-tabs').hidden).toBe(false);
    tabs[2].click(); // Channels: the plain words are still looked for by name
    expect(view.el.querySelector('.search-body h3').textContent).toBe('No channels match “hello”');
    tabs[0].click();
    view.setQuery('in:#general');
    await d.tick(5);
    expect(view.el.querySelector('.search-body h3').textContent).toBe('Nothing to search yet');
    expect(view.el.querySelector('.search-body .empty p').textContent).toBe('Add a word to look for, has:file / has:link, or from:@person');
    view.destroy();
  });
});

describe('a toast that must not be missed', () => {
  it('stays until acted on, survives the pointer passing over it, and goes with Reload or Dismiss', async () => {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    let applied = 0;
    toast('A new version of Teamchat is ready', { duration: Infinity, dismissible: true, action: { label: 'Reload', onClick: () => applied++ } });
    const node = document.querySelector('.toast');
    expect(node.closest('[role="status"]')).not.toBeNull();
    expect(node.querySelector('.toast-close').getAttribute('aria-label')).toBe('Dismiss');
    // A timer of Infinity is clamped to a moment by every runtime: none may be armed.
    await d.tick(30);
    expect(node.isConnected).toBe(true);
    // The pointer passing over a toast re-arms its timer on leaving; not this one.
    node.dispatchEvent(new PointerEvent('pointerenter'));
    node.dispatchEvent(new PointerEvent('pointerleave'));
    await d.tick(1600);
    expect(node.isConnected).toBe(true);
    expect(node.classList.contains('leaving')).toBe(false);
    node.querySelector('.toast-close').click();
    expect(node.classList.contains('leaving')).toBe(true);
    await d.tick(450);
    expect(node.isConnected).toBe(false);
    expect(applied).toBe(0);

    toast('A new version of Teamchat is ready', { duration: Infinity, dismissible: true, action: { label: 'Reload', onClick: () => applied++ } });
    document.querySelector('.toast .toast-action').click();
    expect(applied).toBe(1);
    expect(document.querySelector('.toast').classList.contains('leaving')).toBe(true);
    // An ordinary toast still leaves on its own.
    toast('Saved', { duration: 20 });
    const plain = [...document.querySelectorAll('.toast')].pop();
    await d.tick(500);
    expect(plain.isConnected).toBe(false);
  });
});

describe('the rail', () => {
  it('says what each badge counts: mentions on Home, unread on DMs, new on Activity', async () => {
    const { store, open } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    open();
    store.act.c = { c2: { s: 5, t: 1 }, dm_h: { s: 2, t: 2 }, dm_d: { s: 1, t: 3 } };
    store.me.mentions = { c2: 1 };
    store.me.inbox = 4;
    const { renderRail } = await import('../src/ui/rail.js');
    const rail = document.createElement('nav');
    document.body.append(rail);
    renderRail(rail);
    const labels = () => [...rail.querySelectorAll('.rail-item')].map((n) => n.getAttribute('aria-label'));
    expect(labels()).toEqual(['Home, 1 mention', 'DMs, 3 unread', 'Activity, 4 new', 'Files', 'Later']);
    expect([...rail.querySelectorAll('.rail-badge')].map((n) => n.textContent)).toEqual(['1', '3', '4']);
  });
});

describe('the offline strip', () => {
  it('takes a row of its own above the app while the network is gone, and asks for a sync when it is back', async () => {
    const { dom: d } = await boot();
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    d.navigator.onLine = false;
    const { mountOfflineBanner } = await import('../src/ui/offline.js');
    let synced = 0;
    const strip = mountOfflineBanner({ onReconnect: () => synced++ });
    // Above the app, in the flow: a row of the body's column, not a pill over the top bar.
    expect(document.body.firstElementChild).toBe(strip.el);
    expect(strip.el.nextElementSibling).toBe(app);
    expect(strip.el.getAttribute('role')).toBe('status');
    expect(strip.el.textContent).toContain('You are offline');
    expect(strip.el.querySelector('.offline-note').textContent).toBe('Messages you send will go out when you are back.');
    d.navigator.onLine = true;
    window.dispatchEvent(new Event('online'));
    expect(synced).toBe(1);
    // Emptied, not removed: the live region stays to announce the next time.
    expect(strip.el.isConnected).toBe(true);
    expect(strip.el.textContent).toBe('');
    d.navigator.onLine = false;
    window.dispatchEvent(new Event('offline'));
    expect(strip.el.textContent).toContain('You are offline');
    window.dispatchEvent(new Event('offline')); // said again by the browser: nothing doubles
    expect(strip.el.querySelectorAll('.offline-icon').length).toBe(1);
    expect(synced).toBe(1);
  });
});

describe('Shift+Escape from a filter box', () => {
  it('still marks everything read when the box has words in it, which stay', async () => {
    const { store, app, dom: d } = await shell();
    store.act.c = { c2: { s: 3, t: 1 } }; // #ops has three unread messages
    store.emit('activity');
    await d.tick(5);
    const filter = app.querySelector('.side-filter-input');
    filter.focus();
    d.type(filter, 'op');
    const ev = d.key(filter, 'Escape', { shiftKey: true });
    await d.tick(5);
    expect(filter.value).toBe('op'); // not the box's key: the words stay
    expect(document.querySelector('.modal-root .modal-title')?.textContent).toBe('Mark all messages as read?');
    expect(ev.defaultPrevented).toBe(true); // the shortcut took it
  });

  it('and a modified Escape passes every filter box by; plain Escape still clears it', async () => {
    const { open, dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms` });
    open();
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    const filter = pane.el.querySelector('.side-filter-input');
    d.type(filter, 'dan');
    for (const mod of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      expect(d.key(filter, 'Escape', mod).defaultPrevented).toBe(false);
      expect(filter.value).toBe('dan');
    }
    expect(d.key(filter, 'Escape').defaultPrevented).toBe(true);
    expect(filter.value).toBe('');
    pane.destroy();
  });
});

describe('the top bar search box', () => {
  it('opens the results as you type, after a pause', async () => {
    const { app, dom: d } = await shell();
    const input = app.querySelector('.top-search-input');
    input.focus();
    d.type(input, 'o');
    await d.tick(420);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c1`); // one letter is not yet a search
    d.type(input, 'op');
    // The debounce (350 ms) and the hashchange that follows it run on real
    // timers: waited for, up to a bound, rather than assumed within a fixed
    // pause, which a loaded machine (six test runs at once) has missed.
    for (let waited = 0; !app.querySelector('.search-view') && waited < 3000; waited += 25) await d.tick(25);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/search/op`);
    expect(app.querySelector('.search-view')).not.toBeNull();
  });

  it('does not open the results for a query typed before a conversation was picked', async () => {
    const { app, dom: d } = await shell();
    const input = app.querySelector('.top-search-input');
    input.focus();
    d.type(input, 'op');
    // Within the box's pause, the reader clicks #ops in the sidebar.
    app.querySelector(`.side-item[href="#/ws/${encodeURIComponent(REF)}/c/c2"]`).click();
    await d.tick(5);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c2`);
    await d.tick(420);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c2`);
    expect(app.querySelector('.search-view')).toBeNull();
  });

  it('does not search again for a query cleared before its pause was up', async () => {
    const { app, dom: d } = await shell({ hash: `#/ws/${encodeURIComponent(REF)}/search/ab` });
    await d.tick(5);
    const input = app.querySelector('.top-search-input');
    input.focus();
    d.type(input, 'abc');
    app.querySelector('.top-search-clear').click();
    await d.tick(5);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/search`);
    await d.tick(420);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/search`);
    expect(input.value).toBe('');
  });
});
