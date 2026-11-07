/**
 * Twenty-third review pass, the shell: the shell's router, the lists and
 * the stylesheet, driven in node through tests/helpers/dom.js (a small DOM:
 * elements, selectors, bubbling events with capture, focus, matchMedia by
 * viewport and pointer; no CSS). Every test boots a fresh DOM and a fresh
 * module registry, as tests/ui-shell-pass22.test.js does.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

// Room under load: the focus tests here boot the whole shell and wait on
// real timers, and two of them (Alt+Down from a DMs pane row; the list
// hidden under a conversation on a phone) ran past the 5 s default whenever
// several suites gated at once, then passed alone every time. The lead's
// files give theirs the same room.
vi.setConfig({ testTimeout: 20_000 });

// The conversation column, the huddle dock and the thread panel stand in as
// small boxes: the shell modules under test import them, and none of these
// tests is about them (as tests/ui-shell-pass22.test.js has it).
vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    // Named as the real message box is, so the accessibility walk below audits the shell and not the stub.
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
    close.setAttribute('aria-label', 'Close panel'); // as the real panel's is (see the accessibility walk below)
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

/** A fresh DOM and fresh modules with a faked Puter and a small workspace the store opens when asked (see tests/ui-shell-pass22.test.js). */
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
  return { store, open, calls, dom };
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

describe('the keyboard on a row of a pane (Direct messages, Activity, Later) when a route takes the pane down for the channel list', () => {
  it('goes to the list that took the pane\'s place, on the row of the conversation now open (Alt+Down from a DMs pane row), rather than falling to the page', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { buildHash, parseHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const pane = app.querySelector('.sidebar-pane');
    expect(pane.hidden).toBe(false);
    const row = pane.querySelector(`a.pane-row[href="${buildHash({ ws: REF, conv: 'dm_d', view: 'dms' })}"]`);
    expect(row).not.toBeNull();
    row.focus();
    expect(document.activeElement).toBe(row);
    // The next conversation, by the shortcut: the route drops the pane.
    key(document, { key: 'ArrowDown', altKey: true });
    await ctx.dom.tick(10);
    const r = parseHash(location.hash);
    expect(r.name).toBe('conversation');
    expect(r.view).toBeNull();
    expect(pane.hidden).toBe(true);
    expect(app.querySelector('.sidebar-home').hidden).toBe(false);
    // The keyboard is in the list, on the row of the conversation now open.
    const at = document.activeElement;
    expect(at).not.toBe(document.body);
    expect(app.querySelector('.sidebar-home').contains(at)).toBe(true);
    expect(at.matches('a.side-item')).toBe(true);
    expect(parseHash(at.getAttribute('href')).conv).toBe(r.conv);
  });

  it('goes into the conversation that took the screen on a phone, where the list is hidden under it, not onto a text box', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, width: 400, coarse: true, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { buildHash, parseHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const pane = app.querySelector('.sidebar-pane');
    expect(app.querySelector('.shell').classList.contains('show-sidebar')).toBe(true);
    const row = pane.querySelector(`a.pane-row[href="${buildHash({ ws: REF, conv: 'dm_d', view: 'dms' })}"]`);
    row.focus();
    expect(document.activeElement).toBe(row);
    key(document, { key: 'ArrowDown', altKey: true });
    await ctx.dom.tick(10);
    expect(parseHash(location.hash).name).toBe('conversation');
    expect(app.querySelector('.shell').classList.contains('show-sidebar')).toBe(false);
    const main = app.querySelector('#main');
    expect(main.contains(document.activeElement)).toBe(true);
    expect(/^(input|textarea)$/.test(document.activeElement.localName)).toBe(false);
  });

  it('stays where it is when the route keeps the pane (a row of the pane pressed)', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    const { buildHash } = await import('../src/lib/router.js');
    const app = await mountedShell(ctx);
    const pane = app.querySelector('.sidebar-pane');
    const other = pane.querySelector(`a.pane-row[href="${buildHash({ ws: REF, conv: 'dm_e', view: 'dms' })}"]`);
    expect(other).not.toBeNull();
    other.focus();
    other.click();
    await ctx.dom.tick(10);
    expect(pane.hidden).toBe(false);
    expect(pane.contains(document.activeElement)).toBe(true);
  });
});

describe('the keyboard on a sidebar row\'s kebab when the row goes from the list', () => {
  /** A sidebar over the small workspace, with the kebab of the named channel focused. */
  async function withKebab(title) {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await ctx.dom.tick(5);
    const kebab = [...nav.querySelectorAll('.side-kebab')].find((k) => k.getAttribute('aria-label') === `Options for ${title}`);
    expect(kebab).toBeTruthy();
    kebab.focus();
    expect(document.activeElement).toBe(kebab);
    return { ctx, nav };
  }
  const rows = (nav) => [...nav.querySelectorAll('.side-item')].filter((n) => n.getClientRects().length > 0);

  it('goes to the row that took the left channel\'s place (Leave channel from the kebab\'s menu), not to the page', async () => {
    const { ctx, nav } = await withKebab('#ops');
    const { parseHash } = await import('../src/lib/router.js');
    // Where the row stands among the rows shown; the one below it takes its place.
    const before = rows(nav);
    const at = before.findIndex((r) => parseHash(r.getAttribute('href') || '').conv === 'c2');
    expect(at).toBeGreaterThan(0);
    const below = parseHash(before[at + 1].getAttribute('href') || '').conv;
    // The channel left: the worker's document no longer lists it, and the sidebar is drawn again.
    ctx.store.me.channels = ['c1'];
    ctx.store.emit('workspace');
    await ctx.dom.tick(5);
    const now = document.activeElement;
    expect(now).not.toBe(document.body);
    expect(now.matches('a.side-item')).toBe(true);
    expect(parseHash(now.getAttribute('href')).conv).toBe(below);
  });

  it('stays on the kebab while its row stands (a poll), as before', async () => {
    const { ctx, nav } = await withKebab('#ops');
    ctx.store.emit('activity');
    await ctx.dom.tick(5);
    const now = document.activeElement;
    expect(now.matches('.side-kebab')).toBe(true);
    expect(now.getAttribute('aria-label')).toBe('Options for #ops');
    expect(nav.contains(now)).toBe(true);
  });
});

describe('how a person is (their dot, their status), in the accessible name of the rows that draw them', () => {
  /** The workspace with Dan active and on vacation, Eve offline with no status. */
  async function people(hash = `#/ws/${encodeURIComponent(REF)}/c/c1`) {
    const ctx = await bootApp({ hash, routes: { '/search': () => json({ results: [], cursor: null, hasMore: false, indexed: true, failed: 0 }), '/messages': () => json({ messages: [], seq: 0 }) } });
    ctx.open();
    const { store } = ctx;
    store.presenceOf = (u) => (u === 'u-dan' ? 'active' : 'offline');
    store.statusOf = (u) => (u === 'u-dan' ? { emoji: '🏖️', text: 'On vacation' } : null);
    store.act.c.dm_d = { s: 2, t: 1 };
    return ctx;
  }
  const labelOf = (root, sel, test) => [...root.querySelectorAll(sel)].map((n) => n.getAttribute('aria-label')).find((l) => test.test(l || ''));

  it('sidebar: the direct message rows of the full list and of the filter, and a person the filter finds, say it after the name; nothing for someone offline', async () => {
    const ctx = await people();
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await ctx.dom.tick(5);
    expect(labelOf(nav, '.side-row > .side-item', /^Dan Ito/)).toBe('Dan Ito, active, On vacation, 2 unread');
    expect(labelOf(nav, '.side-row > .side-item', /^Eve Park/)).toBe('Eve Park');
    // The filter's rows say the same.
    ctx.dom.type(nav.querySelector('.side-filter-input'), 'dan');
    expect(labelOf(nav, '.side-results .side-item', /^Dan Ito/)).toBe('Dan Ito, active, On vacation, 2 unread');
    // A person with no conversation yet: their name, how they are, their username.
    delete ctx.store.me.dms.dm_d;
    ctx.dom.type(nav.querySelector('.side-filter-input'), 'da');
    const person = [...nav.querySelectorAll('button.side-item')].find((b) => /Dan Ito/.test(b.textContent));
    expect(person.getAttribute('aria-label')).toBe('Dan Ito, active, On vacation, @dan');
    expect(person.textContent).toContain('@dan');
  });

  it('the Direct messages list: after the name, before the unread count', async () => {
    const ctx = await people(`#/ws/${encodeURIComponent(REF)}/dms`);
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await ctx.dom.tick(5);
    expect(labelOf(pane.el, '.pane-row', /^Dan Ito/)).toBe('Dan Ito, active, On vacation, 2 unread');
    expect(labelOf(pane.el, '.pane-row', /^Eve Park/)).toBe('Eve Park');
    pane.destroy();
  });

  it('the Directory\'s cards and the search results\' People rows: after the name, before "Profile"; an emoji-only status and do-not-disturb said as such', async () => {
    const ctx = await people(`#/ws/${encodeURIComponent(REF)}/directory`);
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const dir = createDirectoryView();
    document.body.append(dir.el);
    await ctx.dom.tick(5);
    expect(labelOf(dir.el, '.dir-card-main', /^Dan Ito/)).toBe('Dan Ito, active, On vacation. Profile');
    expect(labelOf(dir.el, '.dir-card-main', /^Eve Park/)).toBe('Eve Park. Profile');
    // The visible words stay as they were.
    expect([...dir.el.querySelectorAll('.dir-card-name')].some((n) => n.textContent.startsWith('Dan Ito'))).toBe(true);
    dir.destroy();
    ctx.store.presenceOf = (u) => (u === 'u-dan' ? 'dnd' : 'offline');
    ctx.store.statusOf = (u) => (u === 'u-dan' ? { emoji: '🎧', text: '' } : null);
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('dan', { onQuery() {} });
    document.body.append(view.el);
    await ctx.dom.tick(10);
    [...view.el.querySelectorAll('.conv-tab')].find((t) => t.textContent === 'People').click();
    await ctx.dom.tick(5);
    expect(labelOf(view.el, '.search-entity', /^Dan Ito/)).toBe('Dan Ito, do not disturb, 🎧. Profile');
    view.destroy();
  });
});

describe('a reminder come due, listed in Activity', () => {
  it('reads "Reminder: note" under the alarm, not the reader\'s own name and face as the one who said it; the other kinds read as before', async () => {
    const message = { seq: 1, user: 'u-dan', ts: 1000, text: 'water the plants', kind: 'msg', attachments: [], mentions: [], reactions: {} };
    const items = [
      { k: 'reminder', c: 'c1', s: 1, by: 'u-me', ts: Date.now() - 60_000, note: 'call back', rid: 'r1', message },
      { k: 'reminder', c: 'c1', s: 1, by: 'u-me', ts: Date.now() - 120_000, note: '', rid: 'r2', message },
      { k: 'mention', c: 'c1', s: 1, by: 'u-dan', ts: Date.now() - 180_000, message },
    ];
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/activity`, routes: { '/inbox': () => json({ items }), '/inbox/read': () => json({ ok: true }) } });
    ctx.open();
    const { store } = ctx;
    store._schedule = () => {};
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('activity');
    document.body.append(view.el);
    await ctx.dom.tick(10);
    const rows = [...view.el.querySelectorAll('.view-row')];
    expect(rows.length).toBe(3);
    const [withNote, bare, mention] = rows;
    expect(withNote.querySelector('.view-row-head span').textContent).toBe('Reminder: call back');
    expect(withNote.getAttribute('aria-label')).toMatch(/^Reminder: call back in #general, /);
    expect(withNote.querySelector('.avatar')).toBeNull();
    expect(withNote.querySelector('.pin-icon')).not.toBeNull();
    expect(withNote.textContent).not.toContain('Me');
    expect(bare.querySelector('.view-row-head span').textContent).toBe('Reminder');
    expect(bare.getAttribute('aria-label')).toMatch(/^Reminder in #general, /);
    // Someone's mention: their name and face, as before.
    expect(mention.querySelector('.view-row-head span').textContent).toBe('Dan Ito mentioned you');
    expect(mention.getAttribute('aria-label')).toMatch(/^Dan Ito mentioned you in #general, /);
    expect(mention.querySelector('.avatar')).not.toBeNull();
    view.destroy();
  });
});

describe('the search results\' People and Channels tabs while the workspace changes', () => {
  /** The search view on "dan", on the given tab. */
  async function searching(tabLabel) {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/search/dan`, routes: { '/search': () => json({ results: [], cursor: null, hasMore: false, indexed: true, failed: 0 }) } });
    ctx.open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('dan', { onQuery() {} });
    document.body.append(view.el);
    await ctx.dom.tick(10);
    [...view.el.querySelectorAll('.conv-tab')].find((t) => t.textContent === tabLabel).click();
    await ctx.dom.tick(5);
    return { ctx, view };
  }

  it('People: a person renamed, their dot changed, someone new, drawn as it happens, the keyboard kept; nothing redrawn for a change no row shows', async () => {
    const { ctx, view } = await searching('People');
    const { store } = ctx;
    const rows = () => [...view.el.querySelectorAll('.search-person')];
    expect(rows().length).toBe(1);
    expect(rows()[0].querySelector('strong').textContent).toContain('Dan Ito');
    // The keyboard on the row's Message button; the workspace moves for a reason no row shows (a read cursor).
    const message = rows()[0].querySelector('.search-entity-action');
    message.focus();
    const before = rows();
    store.me.reads.c1 = 4;
    store.emit('workspace');
    await ctx.dom.tick(5);
    expect(rows()).toEqual(before);
    expect(document.activeElement).toBe(message);
    // Dan is renamed: the row says so, and the keyboard stays on his Message button.
    store.ws.members['u-dan'].name = 'Daniel Ito';
    store.emit('workspace');
    await ctx.dom.tick(5);
    expect(rows().length).toBe(1);
    expect(rows()[0].querySelector('strong').textContent).toContain('Daniel Ito');
    expect(document.activeElement).toBe(rows()[0].querySelector('.search-entity-action'));
    expect(document.activeElement.getAttribute('aria-label')).toBe('Message Daniel Ito');
    // His dot changes with a poll: said in the row's name.
    store.presenceOf = (u) => (u === 'u-dan' ? 'active' : 'offline');
    store.emit('activity');
    await ctx.dom.tick(5);
    expect(rows()[0].querySelector('.search-entity').getAttribute('aria-label')).toBe('Daniel Ito, active. Profile');
    // Someone new whose name matches joins.
    store.ws.members['u-dana'] = { role: 'member', name: 'Dana Wu', username: 'dana' };
    store.emit('workspace');
    await ctx.dom.tick(5);
    expect(rows().length).toBe(2);
    view.destroy();
  });

  it('Channels: a channel created, renamed or joined shows as it happens; nothing redrawn otherwise', async () => {
    const { ctx, view } = await searching('Channels');
    const { store } = ctx;
    const hits = () => [...view.el.querySelectorAll('.search-entity')];
    expect(hits().length).toBe(0);
    expect(view.el.querySelector('.empty h3').textContent).toBe('No channels match “dan”');
    // A channel created from the sidebar meanwhile, its name matching.
    store.ws.channels.c9 = { id: 'c9', name: 'danube' };
    store.me.channels.push('c9');
    store.emit('workspace');
    await ctx.dom.tick(5);
    expect(hits().length).toBe(1);
    expect(hits()[0].getAttribute('aria-label')).toBe('danube. Open');
    // Left: said as not joined.
    hits()[0].focus();
    store.me.channels = store.me.channels.filter((id) => id !== 'c9');
    store.emit('workspace');
    await ctx.dom.tick(5);
    expect(hits()[0].getAttribute('aria-label')).toBe('danube, not joined. Open');
    expect(document.activeElement).toBe(hits()[0]);
    // A change no row shows: the same rows stand.
    const before = hits();
    store.me.reads.c1 = 9;
    store.emit('workspace');
    await ctx.dom.tick(5);
    expect(hits()).toEqual(before);
    view.destroy();
  });
});

describe('the sidebar section heads\' menu buttons (a section\'s Options, Add a channel)', () => {
  it('say they open a menu (aria-haspopup), and that it is open while it stands, as every other menu button does', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    ctx.store.profile.prefs.sections = { [REF]: [{ id: 's1', name: 'Projects', items: ['c2'] }] };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const { closeMenu } = await import('../src/ui/menu.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await ctx.dom.tick(5);
    for (const label of ['Options for Projects', 'Add a channel']) {
      const btn = nav.querySelector(`.side-head [aria-label="${label}"]`);
      expect(btn).not.toBeNull();
      expect(btn.getAttribute('aria-haspopup')).toBe('menu');
      btn.click();
      await ctx.dom.tick(2);
      expect(document.querySelector('.menu[role="menu"]')).not.toBeNull();
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      closeMenu();
      await ctx.dom.tick(2);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    }
    // A head button that opens a dialog, not a menu, says nothing of the kind.
    expect(nav.querySelector('.side-head [aria-label="New message"]').hasAttribute('aria-haspopup')).toBe(false);
  });
});

describe('the keyboard shortcuts panel\'s keys, in words', () => {
  it('are said to a screen reader as "Shift Command K", not by the glyphs\' names, and found by those words and their short forms (the test shim is a Mac)', async () => {
    const ctx = await bootApp();
    ctx.open();
    const { renderShortcutsPanel } = await import('../src/ui/shortcuts.js');
    const panel = document.createElement('aside');
    document.body.append(panel);
    renderShortcutsPanel(panel, { onClose() {} });
    await ctx.dom.tick(2);
    const rowOf = (what) => [...panel.querySelectorAll('.shortcut-row')].find((r) => r.querySelector('.shortcut-what').textContent === what);
    const keysOf = (what) => rowOf(what).querySelector('.shortcut-keys');
    // The caps keep the glyphs; the words go to assistive technology.
    expect([...keysOf('New message').querySelectorAll('.key-cap')].map((k) => k.textContent)).toEqual(['⇧', '⌘', 'K']);
    expect(keysOf('New message').getAttribute('aria-label')).toBe('Shift Command K');
    expect(keysOf('New message').getAttribute('role')).toBe('img');
    expect(keysOf('Next conversation').getAttribute('aria-label')).toBe('Option Down arrow');
    expect(keysOf('Mark every conversation read').getAttribute('aria-label')).toBe('Shift Escape');
    // Found by the words and their short forms.
    const search = panel.querySelector('.shortcuts-search');
    const whats = () => [...panel.querySelectorAll('.shortcut-what')].map((n) => n.textContent);
    ctx.dom.type(search, 'cmd k');
    expect(whats()).toContain('Search, or jump to a conversation');
    expect(whats()).not.toContain('Next conversation');
    ctx.dom.type(search, 'command k');
    expect(whats()).toContain('Search, or jump to a conversation');
    ctx.dom.type(search, 'option');
    expect(whats()).toContain('Next conversation');
    expect(whats()).not.toContain('Bold');
    ctx.dom.type(search, 'alt down');
    expect(whats()).toContain('Next conversation');
    ctx.dom.type(search, 'shift esc');
    expect(whats()).toContain('Mark every conversation read');
    ctx.dom.type(search, 'escape');
    expect(whats()).toContain('Close the side panel, a menu, or a dialog');
    // The glyphs themselves still find their rows, as before.
    ctx.dom.type(search, '⌘ /');
    expect(whats()).toContain('Toggle this panel');
  });
});

describe('the Direct messages list\'s last line for a conversation whose only loaded line the system wrote and an admin then deleted', () => {
  /** A DMs pane over a conversation window holding the given lines. */
  async function paneWith(lines) {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms` });
    ctx.open();
    const { store } = ctx;
    const c = store.conv('dm_d');
    c.messages = lines;
    c.loaded = true;
    c.seq = lines[lines.length - 1].seq;
    store.act.c.dm_d = { s: c.seq, t: 1000 };
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await ctx.dom.tick(5);
    const row = [...pane.el.querySelectorAll('.pane-row')].find((r) => /Dan Ito/.test(r.textContent));
    return { ctx, pane, text: row.querySelector('.pane-row-text span').textContent };
  }
  const line = (seq, extra) => ({ seq, user: 'u-dan', ts: seq * 1000, text: '', attachments: [], mentions: [], reactions: {}, ...extra });

  it('says the line was deleted, as it does for any deleted message, rather than "No messages yet"', async () => {
    // The tombstone keeps no words (see shared/blocks.js): the line's kind alone must not read them.
    const { pane, text } = await paneWith([line(1, { kind: 'sys', deleted: true })]);
    expect(text).toBe('Message deleted');
    pane.destroy();
  });

  it('still shows a standing system line as written, and a deleted message as deleted', async () => {
    const a = await paneWith([line(1, { kind: 'sys', text: 'Huddle ended after 5 min' })]);
    expect(a.text).toBe('Huddle ended after 5 min');
    a.pane.destroy();
    const b = await paneWith([line(1, { kind: 'msg', deleted: true })]);
    expect(b.text).toBe('Message deleted');
    b.pane.destroy();
  });
});

describe('no unnamed control in the shell (an accessibility walk of every view, pane and menu the shell shows)', () => {
  // What a screen reader would be handed with nothing to say for it: every
  // interactive element, checked for an accessible name (aria-label,
  // aria-labelledby, a label for an input, its own words, an inner image's
  // alt, a title), and for the ARIA its role requires (a tab in a tablist
  // with aria-selected, an option in a listbox, a menu item in a menu, a
  // radio/checkbox/switch with aria-checked, a radio in a radiogroup), for
  // aria-controls that names an id on the page, for ids used twice, for a
  // control drawn as pressed (.active) that carries no state, for a list
  // whose children are not list items, and for an open menu whose button
  // does not say it is expanded. The conversation column, the thread panel
  // and the huddle dock are this file's stubs (see the mocks at the top):
  // their real controls are ui-conv's, walked by the audit that made this
  // test and found clean. An input named by its placeholder alone counts as
  // unnamed here: every box in the shell carries an aria-label.
  const SEL = 'button, a[href], input, textarea, select, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [tabindex="0"]';
  function textOf(n) {
    let s = '';
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true') s += c.localName === 'img' ? (c.getAttribute('alt') || '') : textOf(c);
    }
    return s;
  }
  function nameOf(n) {
    const al = n.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const lb = n.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    if (/^(input|textarea|select)$/.test(n.localName)) {
      if (n.id) {
        const l = document.querySelector(`label[for="${n.id}"]`);
        if (l && l.textContent.trim()) return l.textContent.trim();
      }
      const wrap = n.closest('label');
      if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    }
    const t = textOf(n).trim();
    if (t) return t;
    const title = n.getAttribute('title');
    return title && title.trim() ? title.trim() : '';
  }
  const describe_ = (n) => `${n.localName}${n.id ? `#${n.id}` : ''}${n.className ? `.${String(n.className).trim().split(/\s+/).join('.')}` : ''}${n.getAttribute('role') ? `[role=${n.getAttribute('role')}]` : ''}`;
  function audit(view) {
    const hits = new Set();
    const push = (kind, n, extra = '') => hits.add(`${view} :: ${kind} :: ${describe_(n)}${extra ? ` :: ${extra}` : ''}`);
    let controls = 0;
    for (const n of document.querySelectorAll(SEL)) {
      if (n.closest('[hidden]')) continue;
      controls++;
      if (!nameOf(n)) push('unnamed', n, (n.outerHTML || '').slice(0, 100).replace(/\s+/g, ' '));
      const role = n.getAttribute('role') || '';
      if (role === 'tab' && !n.closest('[role="tablist"]')) push('tab outside tablist', n);
      if (role === 'tab' && !n.hasAttribute('aria-selected')) push('tab without aria-selected', n);
      if (role === 'option' && !n.closest('[role="listbox"]')) push('option outside listbox', n);
      if (/^menuitem/.test(role) && !n.closest('[role="menu"], [role="menubar"]')) push('menuitem outside menu', n);
      if (/^(radio|checkbox|switch|menuitemradio|menuitemcheckbox)$/.test(role) && !n.hasAttribute('aria-checked')) push('no aria-checked', n);
      if (role === 'radio' && !n.closest('[role="radiogroup"]')) push('radio outside radiogroup', n);
      const ac = n.getAttribute('aria-controls');
      if (ac && !document.getElementById(ac)) push('aria-controls names no id', n, ac);
      if (n.classList?.contains('active') && !['aria-pressed', 'aria-current', 'aria-expanded', 'aria-checked', 'aria-selected'].some((a) => n.hasAttribute(a))) push('active without a state', n);
    }
    for (const list of document.querySelectorAll('[role="list"]')) {
      if (list.closest('[hidden]')) continue;
      for (const c of list.children) if (!c.hasAttribute('hidden') && c.getAttribute('role') !== 'listitem') push('list child not a listitem', c);
    }
    const ids = new Map();
    for (const n of document.querySelectorAll('[id]')) ids.set(n.id, (ids.get(n.id) || 0) + 1);
    for (const [id, c] of ids) if (c > 1) hits.add(`${view} :: duplicate id :: #${id} ×${c}`);
    if (document.querySelector('.menu[role="menu"]') && ![...document.querySelectorAll('[aria-haspopup]')].some((n) => n.getAttribute('aria-expanded') === 'true')) hits.add(`${view} :: menu open :: no button says aria-expanded=true`);
    return { hits: [...hits], controls };
  }

  it('finds a name and the required state on every control, in every view', async () => {
    const NOW = Date.now();
    const m = (seq, extra = {}) => ({ seq, user: 'u-dan', ts: NOW - (10 - seq) * 60_000, text: `message ${seq}`, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });
    const routes = {
      '/messages': () => json({ messages: [m(1), m(2)], seq: 2 }),
      '/threads': () => json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: NOW - 1000, unread: 1, root: m(1, { replyCount: 1 }) }] }),
      '/inbox': () => json({ items: [
        { k: 'mention', c: 'c1', s: 1, by: 'u-dan', ts: NOW - 1000, message: m(1) },
        { k: 'reply', c: 'c1_t1', s: 1, by: 'u-eve', ts: NOW - 2000, message: m(1) },
        { k: 'reaction', c: 'c1', s: 2, by: 'u-eve', ts: NOW - 3000, r: '+1', message: m(2) },
        { k: 'reminder', c: 'c1', s: 1, by: 'u-me', ts: NOW - 4000, note: 'call back', rid: 'r1', message: m(1) },
        { k: 'huddle', c: 'dm_d', s: 1, by: 'u-dan', ts: NOW - 5000 },
      ] }),
      '/inbox/read': () => json({ ok: true }),
      '/saved': () => json({ items: [{ c: 'c1', s: 1, ts: NOW - 1000, done: false, message: m(1) }, { c: 'c1', s: 2, ts: NOW - 2000, done: true, message: m(2) }] }),
      '/scheduled': () => json({ scheduled: [{ id: 's1', kind: 'message', conv: 'c1', text: 'later', dueAt: NOW + 3_600_000, createdAt: NOW }, { id: 's2', kind: 'message', conv: 'c2', text: 'refused', dueAt: NOW - 100, createdAt: NOW, failed: { at: NOW, code: 'archived', message: 'Channel archived' } }], reminders: [{ id: 'r1', kind: 'reminder', conv: 'c1', seq: 1, dueAt: NOW + 3_600_000, note: 'call back', message: m(1) }] }),
      '/search': () => json({ results: [{ ...m(1), conv: 'c1', attachments: [{ id: 'f1', name: 'plan.pdf', type: 'application/pdf', size: 12 }] }, { ...m(2), conv: 'c1', text: 'see https://example.com/page' }], cursor: 'c2', hasMore: true, indexed: null, failed: 2 }),
    };
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, routes });
    const { store } = ctx;
    const { setDraft, draftKey } = await import('../src/lib/drafts.js');
    const { buildHash } = await import('../src/lib/router.js');
    const { closeMenu } = await import('../src/ui/menu.js');
    const { closeAllModals } = await import('../src/ui/modal.js');
    const app = await mountedShell(ctx);
    // A fuller workspace than bootApp's: an archived and muted channel with a
    // draft, an admins-only one not joined, a private one with a huddle, a
    // group and a self conversation, a custom section, a star, unread and
    // mentions, a followed thread, activity, saved and scheduled items, a
    // second workspace in the switcher, a guest and an owner.
    store.ws.channels.c3 = { id: 'c3', name: 'random', archived: true, count: 2 };
    store.ws.channels.c4 = { id: 'c4', name: 'announce', postPolicy: 'admins', count: 3 };
    store.ws.channels.c2.private = true;
    store.ws.channels.c2.members = ['u-me', 'u-dan'];
    store.ws.members['u-me'].role = 'owner';
    store.ws.members['u-eve'].role = 'guest';
    store.ws.members['u-dan'].status = { emoji: '🏖️', text: 'On vacation' };
    store.me.role = 'owner';
    store.me.channels = ['c1', 'c2', 'c3'];
    store.me.dms.dm_g = { members: ['u-me', 'u-dan', 'u-eve'], createdAt: 2 };
    store.me.dms.dm_me = { members: ['u-me'], createdAt: 1 };
    store.me.reads = { c1: 1 };
    store.me.mentions = { c1: 1 };
    store.me.notify = { c3: { mute: true } };
    store.me.threads = { c1_t1: 1 };
    store.me.inbox = 2;
    store.act.c = { c1: { s: 3, t: NOW }, dm_d: { s: 2, t: NOW - 1 }, dm_g: { s: 1, t: NOW - 2 } };
    store.act.p = { 'u-dan': NOW };
    store.huddles = { c2: { by: 'u-dan', at: NOW, m: { 'u-dan': { j: NOW } } } };
    store.profile.prefs.sections = { [REF]: [{ id: 'sec1', name: 'Projects', items: ['c2'] }] };
    store.profile.prefs.starred = { [REF]: ['dm_d'] };
    store.workspaces = [{ id: REF, name: 'Globex' }, { id: 'ffff000000@teamchat-test', name: 'Initech' }];
    store._scheduledCount = 2;
    store._reminderCount = 1;
    store._savedCount = 1;
    setDraft(draftKey(REF, 'c3'), { text: 'an unsent thought' });
    store.emit('workspace');
    store.emit('activity');
    store.emit('huddle');
    await ctx.dom.tick(10);

    const found = [];
    let walked = 0;
    const go = async (h) => { location.hash = h; await ctx.dom.tick(30); };
    const click = (sel) => { const n = document.querySelector(sel); if (!n) throw new Error(`nothing matches ${sel}`); n.click(); };
    const clickText = (sel, text) => { const n = [...document.querySelectorAll(sel)].find((b) => (b.textContent || '').trim().startsWith(text)); if (!n) throw new Error(`no ${sel} reading "${text}"`); n.click(); };
    const step = async (name, fn) => {
      await fn();
      await ctx.dom.tick(5);
      const { hits, controls } = audit(name);
      expect(controls, `${name}: nothing to audit`).toBeGreaterThan(0);
      found.push(...hits);
      walked++;
      closeMenu();
      closeAllModals();
      await ctx.dom.tick(300);
    };
    await step('channel', () => go(buildHash({ ws: REF, conv: 'c1' })));
    await step('private channel with a huddle', () => go(buildHash({ ws: REF, conv: 'c2' })));
    await step('archived, muted channel with a draft', () => go(buildHash({ ws: REF, conv: 'c3' })));
    await step('admins-only channel, not joined', () => go(buildHash({ ws: REF, conv: 'c4' })));
    await step('direct message', () => go(buildHash({ ws: REF, conv: 'dm_d' })));
    await step('group direct message', () => go(buildHash({ ws: REF, conv: 'dm_g' })));
    await step('own space', () => go(buildHash({ ws: REF, conv: 'dm_me' })));
    await step('thread panel', () => go(buildHash({ ws: REF, conv: 'c1', thread: 1 })));
    await step('Threads view', () => go(buildHash({ ws: REF, view: 'threads' })));
    for (const f of ['All', 'Mentions', 'Replies', 'Reactions', 'Reminders']) {
      await step(`Activity (${f})`, async () => { await go(buildHash({ ws: REF, view: 'activity' })); clickText('.sidebar-pane [role="radio"]', f); await ctx.dom.tick(20); });
    }
    for (const f of ['Saved', 'Reminders', 'Scheduled']) {
      await step(`Later (${f})`, async () => { await go(buildHash({ ws: REF, view: 'later' })); clickText('.sidebar-pane [role="radio"]', f); await ctx.dom.tick(20); });
    }
    for (const f of ['Drafts', 'Scheduled', 'Sent']) {
      await step(`Drafts & sent (${f})`, async () => { await go(buildHash({ ws: REF, view: 'drafts' })); clickText('#main [role="radio"]', f); await ctx.dom.tick(20); });
    }
    await step('Files view', () => go(buildHash({ ws: REF, view: 'files' })));
    await step('Directory (People)', () => go(buildHash({ ws: REF, view: 'directory' })));
    await step('Directory (Channels)', async () => { clickText('#main [role="tab"]', 'Channels'); await ctx.dom.tick(10); });
    for (const t of ['Messages', 'Files', 'Channels', 'People']) {
      await step(`search (${t})`, async () => { await go(buildHash({ ws: REF, query: 'message' })); clickText('#main [role="tab"]', t); await ctx.dom.tick(20); });
    }
    await step('DMs pane', () => go(buildHash({ ws: REF, conv: 'dm_d', view: 'dms' })));
    await step('top bar search dropdown', async () => { await go(buildHash({ ws: REF, conv: 'c1' })); document.querySelector('.top-search-input').focus(); });
    await step('workspace menu', () => click('.ws-switch'));
    await step('rail workspace menu', () => click('.rail-mark'));
    await step('Manage my sidebar menu', () => click('[aria-label="Manage my sidebar"]'));
    await step('user menu', () => click('.rail-me'));
    await step('rail New menu', () => click('.rail-round[aria-label="New"]'));
    await step('history menu', () => click('[aria-label="History"]'));
    await step('pause menu', () => click('.side-footer [aria-haspopup="menu"]'));
    await step('sidebar row menu', () => click('.side-kebab[aria-label="Options for #general"]'));
    await step('sidebar row Move to… list', async () => { click('.side-kebab[aria-label="Options for #general"]'); await ctx.dom.tick(5); clickText('.menu .menu-item', 'Move to…'); });
    await step('section Options menu', () => click('[aria-label="Options for Projects"]'));
    await step('Add a channel menu', () => click('[aria-label="Add a channel"]'));
    await step('shortcuts panel', () => key(document, { key: '/', metaKey: true }));
    await step('offline strip', async () => {
      const { mountOfflineBanner } = await import('../src/ui/offline.js');
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      mountOfflineBanner({ onReconnect() {} });
    });
    expect(walked).toBeGreaterThan(30);
    expect(found, `\n${found.join('\n')}`).toEqual([]);
    expect(app).toBeTruthy();
  }, 60_000);
});
