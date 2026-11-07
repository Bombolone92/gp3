/**
 * Thirteenth review pass, the shell: the top bar, the sidebar, the rail,
 * the shortcuts and the list views, driven in node through
 * tests/helpers/dom.js (a small DOM: elements, selectors, bubbling events,
 * focus, a hash location that fires hashchange on the next tick, matchMedia
 * by viewport). Every test boots a fresh DOM and a fresh module registry, so
 * the listeners the shell hangs on window and document never outlive their
 * test. Puter is faked at `puter.workers.exec`, as in tests/store.test.js;
 * the conversation column and the huddle window are stubbed (their own
 * tests cover them).
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

describe('Shift+Escape from the top bar search box', () => {
  it('still marks everything read when the box has words in it, which stay', async () => {
    const { store, app, dom: d } = await shell();
    store.act.c = { c2: { s: 3, t: 1 } }; // #ops has three unread messages
    store.emit('activity');
    await d.tick(5);
    const input = app.querySelector('.top-search-input');
    input.focus();
    d.type(input, 'o'); // one letter: not yet a search, so no results open under the dialog
    const ev = d.key(input, 'Escape', { shiftKey: true });
    await d.tick(5);
    expect(input.value).toBe('o'); // not the box's key: the words stay
    expect(document.querySelector('.modal-root .modal-title')?.textContent).toBe('Mark all messages as read?');
    expect(ev.defaultPrevented).toBe(true); // the shortcut took it
  });

  it('passes the box by with its suggestions open too, and a plain Escape still closes them, then clears', async () => {
    const { store, app, dom: d } = await shell();
    store.act.c = { c2: { s: 3, t: 1 } };
    store.emit('activity');
    await d.tick(5);
    const input = app.querySelector('.top-search-input');
    const drop = app.querySelector('.top-search-drop');
    input.focus();
    expect(drop.hidden).toBe(false); // an empty, focused box offers its suggestions
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      // Somebody else's key: the box neither closes its suggestions nor claims the press.
      expect(d.key(input, 'Escape', mod).defaultPrevented).toBe(false);
      expect(drop.hidden).toBe(false);
    }
    const ev = d.key(input, 'Escape', { shiftKey: true });
    await d.tick(5);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector('.modal-root .modal-title')?.textContent).toBe('Mark all messages as read?');
    const { closeAllModals } = await import('../src/ui/modal.js');
    closeAllModals();
    await d.tick(5);
    // The plain key is still the box's: the suggestions first, then the words.
    input.focus();
    expect(drop.hidden).toBe(false);
    expect(d.key(input, 'Escape').defaultPrevented).toBe(true);
    expect(drop.hidden).toBe(true);
    d.type(input, 'o');
    expect(d.key(input, 'Escape').defaultPrevented).toBe(true);
    expect(input.value).toBe('');
  });
});

describe('the Activity view in a tab nobody is looking at', () => {
  const mention = (seq) => ({ k: 'mention', c: 'c1', s: seq, by: 'u-dan', ts: 1000 + seq, message: { seq, user: 'u-dan', ts: 1000 + seq, text: `hi @me ${seq}`, kind: 'msg' } });

  it('leaves the badge for news that lands while the tab is hidden, and reads it once the tab is seen again', async () => {
    const reads = [];
    let items = [mention(3)];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/activity`,
      routes: {
        '/inbox/read': () => { reads.push(1); return json({ ok: true }); },
        '/inbox': () => json({ items }),
      },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    store._schedule = () => {}; // the store's own visibilitychange handler would start a poll
    store.me.inbox = 1;
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('activity');
    document.body.append(view.el);
    await d.tick(5);
    // Opened and looked at: read, here and on every other device.
    expect(reads.length).toBe(1);
    expect(store.me.inbox).toBe(0);
    expect(view.el.querySelectorAll('.view-row').length).toBe(1);
    store.emit('workspace'); // the poll's first word since the view opened: the baseline
    await d.tick(5);
    // The reader goes to another tab; a mention lands while they are away.
    document.hidden = true;
    items = [mention(4), mention(3)];
    store.me.inbox = 1;
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelectorAll('.view-row').length).toBe(2); // the list is drawn afresh all the same
    expect(reads.length).toBe(1); // but not read: nobody has seen it, and the phone keeps its badge
    expect(store.me.inbox).toBe(1);
    expect(store.inboxUnread()).toBe(1);
    // Back to the tab: now it is seen.
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await d.tick(5);
    expect(reads.length).toBe(2);
    expect(store.me.inbox).toBe(0);
    // Nothing more to read: coming back again asks the worker nothing.
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await d.tick(5);
    expect(reads.length).toBe(2);
    view.destroy();
    // Gone from the page: a tab shown again reads nothing on its behalf.
    store.me.inbox = 1;
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await d.tick(5);
    expect(reads.length).toBe(2);
  });
});

describe('Alt+↓ and Alt+↑ from inside the sidebar', () => {
  it('step to the next and previous conversation from a focused row, and from the filter box, rather than only moving the focus', async () => {
    const { app, dom: d } = await shell();
    const conv = () => decodeURIComponent(location.hash.split('/c/')[1]);
    const row = app.querySelector(`.side-item[href="#/ws/${encodeURIComponent(REF)}/c/c1"]`);
    row.focus();
    expect(document.activeElement).toBe(row);
    d.key(row, 'ArrowDown', { altKey: true });
    await d.tick(5);
    expect(conv()).toBe('c2'); // the shortcut, not the list's arrow
    d.key(document.activeElement, 'ArrowUp', { altKey: true });
    await d.tick(5);
    expect(conv()).toBe('c1');
    // The plain arrow is still the list's: focus moves to the next row and the conversation stays.
    const before = document.activeElement;
    d.key(before, 'ArrowDown');
    await d.tick(5);
    expect(document.activeElement).not.toBe(before);
    expect(document.activeElement.classList.contains('side-item')).toBe(true);
    expect(conv()).toBe('c1');
    // From the filter box as well.
    const filter = app.querySelector('.side-filter-input');
    filter.focus();
    d.key(filter, 'ArrowDown', { altKey: true });
    await d.tick(5);
    expect(conv()).toBe('c2');
    expect(document.activeElement).toBe(filter); // the box keeps the keyboard
    d.key(filter, 'ArrowDown');
    expect(document.activeElement.classList.contains('side-item')).toBe(true); // plain: down into the list
  });
});

describe('radiogroups built from buttons', () => {
  const stateOf = (radios) => radios.map((n) => `${n.textContent.trim() || n.getAttribute('aria-label')}:${n.getAttribute('aria-checked') === 'true' ? 'on' : 'off'}:${n.getAttribute('tabindex')}`);

  it('the Later view\'s Show group has one tab stop, and the arrows move and choose, wrapping, with Home and End at the ends', async () => {
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/later`,
      routes: { '/saved': () => json({ items: [] }), '/scheduled': () => json({ reminders: [], scheduled: [] }) },
    });
    const { dom: d } = ctx;
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await d.tick(5);
    const radios = () => [...view.el.querySelectorAll('.view-seg [role="radio"]')];
    expect(stateOf(radios())).toEqual(['Saved:on:0', 'Reminders:off:-1', 'Scheduled:off:-1']);
    radios()[0].focus();
    expect(d.key(radios()[0], 'ArrowRight').defaultPrevented).toBe(true);
    expect(stateOf(radios())).toEqual(['Saved:off:-1', 'Reminders:on:0', 'Scheduled:off:-1']);
    expect(document.activeElement).toBe(radios()[1]); // the keyboard follows the choice through the redraw
    await d.tick(5);
    expect(view.el.querySelector('.view-body h3')?.textContent).toBe('No reminders'); // the choice took
    d.key(document.activeElement, 'ArrowDown');
    expect(stateOf(radios())).toEqual(['Saved:off:-1', 'Reminders:off:-1', 'Scheduled:on:0']);
    d.key(document.activeElement, 'ArrowRight'); // past the end: round to the first
    expect(stateOf(radios())).toEqual(['Saved:on:0', 'Reminders:off:-1', 'Scheduled:off:-1']);
    d.key(document.activeElement, 'ArrowLeft'); // before the first: round to the last
    expect(stateOf(radios())[2]).toBe('Scheduled:on:0');
    d.key(document.activeElement, 'Home');
    expect(stateOf(radios())[0]).toBe('Saved:on:0');
    d.key(document.activeElement, 'End');
    expect(stateOf(radios())[2]).toBe('Scheduled:on:0');
    expect(document.activeElement).toBe(radios()[2]);
    // A modified arrow is a shortcut's: it passes and changes nothing.
    for (const mod of [{ altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
      expect(d.key(document.activeElement, 'ArrowLeft', mod).defaultPrevented).toBe(false);
      expect(stateOf(radios())[2]).toBe('Scheduled:on:0');
    }
    // A click with the pointer moves the tab stop as well.
    radios()[0].click();
    expect(stateOf(radios())).toEqual(['Saved:on:0', 'Reminders:off:-1', 'Scheduled:off:-1']);
    await d.tick(5);
    view.destroy();
  });

  it('the Transfer ownership pick-list does the same, opens on its tab stop, and keeps the other radios out of the dialog\'s Tab order', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.owner = 'u-me';
    store.ws.members['u-jose'].role = 'admin';
    store.ws.members['u-hanna'].role = 'admin';
    const { transferDialog } = await import('../src/ui/dialogs.js');
    const { focusables } = await import('../src/ui/dom.js');
    const { closeAllModals } = await import('../src/ui/modal.js');
    transferDialog();
    await d.tick(5);
    const panel = document.querySelector('.modal-root .modal-panel');
    const radios = () => [...panel.querySelectorAll('.pick-list [role="radio"]')];
    const picks = () => radios().map((n) => `${n.querySelector('.pick-text strong').textContent}:${n.getAttribute('aria-checked') === 'true' ? 'on' : 'off'}:${n.getAttribute('tabindex')}`);
    expect(picks()).toEqual(['José Álvarez:on:0', 'Hanna Müller:off:-1']);
    expect(document.activeElement).toBe(radios()[0]); // the dialog opens on its first field: the chosen radio
    expect(focusables(panel).filter((n) => n.getAttribute('role') === 'radio')).toEqual([radios()[0]]); // one stop in the Tab ring
    d.key(radios()[0], 'ArrowDown');
    expect(picks()).toEqual(['José Álvarez:off:-1', 'Hanna Müller:on:0']);
    expect(document.activeElement).toBe(radios()[1]);
    d.key(radios()[1], 'ArrowUp');
    expect(picks()[0]).toBe('José Álvarez:on:0');
    expect(document.activeElement).toBe(radios()[0]);
    closeAllModals();
    await d.tick(250);
  });
});

describe('the search view read aloud', () => {
  it('announces the count of the tab on show, not the Messages count under a Channels or People list', async () => {
    const hit = (seq) => ({ conv: 'c1', seq, ts: 1000 + seq, user: 'u-dan', text: `ops ${seq}`, kind: 'msg' });
    const { open, dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/search/ops`,
      routes: { '/search': () => json({ results: [hit(1), hit(2), hit(3)], indexed: true }) },
    });
    open();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('ops', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(5);
    const status = view.el.querySelector('[role="status"]');
    const tabs = () => [...view.el.querySelectorAll('.conv-tab')];
    expect(status.textContent).toBe('3 results');
    tabs()[2].click(); // Channels: #ops matches
    expect(view.el.querySelector('.search-end').textContent).toBe('1 channel');
    expect(status.textContent).toBe('1 channel');
    tabs()[3].click(); // People: nobody is called ops
    expect(view.el.querySelector('.search-body h3').textContent).toBe('Nobody matches “ops”');
    expect(status.textContent).toBe('Nobody matches “ops”');
    tabs()[0].click(); // back to Messages: searched again, counted again
    await d.tick(5);
    expect(status.textContent).toBe('3 results');
    view.destroy();
  });
});

describe('a private channel nobody is left in', () => {
  // As the worker lists it to an admin: an orphan with an empty member list, the admin not in it.
  const orphan = () => ({ id: 'c9', name: 'old-project', private: true, members: [], orphan: true, count: 0, createdBy: 'u-dan', createdAt: 1000 });
  const asAdmin = (store) => {
    store.ws.members['u-me'].role = 'admin';
    store.ws.channels.c9 = orphan();
  };

  it('is offered nowhere as a place to open, search, join or post into, and a link to its details drops the request', async () => {
    const { store, app, dom: d } = await shell();
    asAdmin(store);
    store.emit('workspace');
    await d.tick(5);
    expect(store.canAccess('c9')).toBe(false);
    expect(store.canCurate('c9')).toBe(false);
    expect(store.canHuddle('c9')).toBe(false);
    expect(store.joinedChannels().map((c) => c.id)).not.toContain('c9');
    expect(store.browsableChannels().map((c) => c.id)).not.toContain('c9');
    expect(store.orphanChannels().map((c) => c.id)).toEqual(['c9']);
    // Not a row of the sidebar, nor a match of its filter.
    expect(app.querySelector(`.side-item[href$="/c/c9"]`)).toBeNull();
    d.type(app.querySelector('.side-filter-input'), 'old');
    expect([...app.querySelectorAll('.side-item .side-label')].map((n) => n.textContent)).toEqual([]);
    d.type(app.querySelector('.side-filter-input'), '');
    // Not a Directory channel.
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const dir = createDirectoryView();
    document.body.append(dir.el);
    dir.el.querySelectorAll('.conv-tab')[1].click();
    expect([...dir.el.querySelectorAll('.dir-row-text strong')].map((n) => n.textContent)).toEqual(['general', 'ops', 'zeta']);
    dir.destroy();
    // Not a channel to search in, nor one the Channels tab finds.
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('in:#old-project hello', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(5);
    expect(view.el.querySelector('.search-body .empty p').textContent).toBe('There is no #old-project here');
    view.setQuery('old');
    await d.tick(5);
    view.el.querySelectorAll('.conv-tab')[2].click();
    expect(view.el.querySelector('.search-body h3').textContent).toBe('No channels match “old”');
    view.destroy();
    // An old link to it: no "Search in #old-project" offered at the top, nothing remembered as visited, and its details never open.
    location.hash = `#/ws/${encodeURIComponent(REF)}/c/c9/details`;
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/c9`);
    expect(document.querySelector('.modal-root')).toBeNull();
    const input = app.querySelector('.top-search-input');
    input.focus();
    expect(app.querySelector('.top-drop-scope')).toBeNull();
    const { recentConvs } = await import('../src/lib/recent.js');
    expect(recentConvs(REF)).not.toContain('c9');
  });

  it('is listed in Browse channels to an admin, with Delete, and to nobody else; Delete asks first and then takes the row away', async () => {
    const calls = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/c/c1`,
      routes: { '/channels/c9': (q, init) => { calls.push(init.method); return json({ ok: true }); } },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.channels.c9 = orphan();
    store.refreshAfterChange = async () => { delete store.ws.channels.c9; store.emit('workspace'); };
    const { browseChannelsDialog } = await import('../src/ui/dialogs.js');
    const { closeAllModals } = await import('../src/ui/modal.js');
    // A plain member sees only the public list, orphan or not.
    browseChannelsDialog();
    await d.tick(5);
    let panel = document.querySelector('.modal-root:not(.closing) .modal-panel');
    expect(panel.querySelector('.orphan-channels').hidden).toBe(true);
    expect([...panel.querySelectorAll('.pick-item strong')].map((n) => n.textContent)).toEqual(['general', 'ops', 'zeta']);
    closeAllModals();
    await d.tick(250);
    // An admin sees it under its own heading, with the lock, why it is here, and Delete: no Join, no Open.
    store.ws.members['u-me'].role = 'admin';
    browseChannelsDialog();
    await d.tick(5);
    panel = document.querySelector('.modal-root:not(.closing) .modal-panel');
    const box = panel.querySelector('.orphan-channels');
    expect(box.hidden).toBe(false);
    expect(box.querySelector('h3').textContent).toBe('Private channels nobody is left in');
    const row = box.querySelector('.pick-item');
    expect(row.querySelector('strong').textContent).toBe('old-project');
    expect(row.querySelector('.pick-wrap').textContent).toBe('Nobody is in this channel; its last member left the workspace.');
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Delete']);
    expect(panel.querySelector('[aria-label="Join #old-project"]')).toBeNull();
    expect(panel.querySelector('[aria-label="Open #old-project"]')).toBeNull();
    // Delete asks, in words that say nobody can open it and that its history goes for good.
    row.querySelector('[aria-label="Delete #old-project"]').click();
    await d.tick(5);
    const confirm = [...document.querySelectorAll('.modal-root:not(.closing)')].pop();
    expect(confirm.querySelector('.modal-title').textContent).toBe('Delete #old-project?');
    expect(confirm.querySelector('p').textContent).toBe('Nobody can open it any more: its last member left the workspace. Its messages and files are removed for good.');
    confirm.querySelector('.btn-danger').click();
    await d.tick(10);
    expect(calls).toEqual(['DELETE']);
    expect(store.ws.channels.c9).toBeUndefined();
    expect(panel.querySelector('.orphan-channels').hidden).toBe(true);
    expect(document.querySelector('.toast')?.textContent).toBe('#old-project deleted');
    closeAllModals();
    await d.tick(250);
  });

  it('opened from an old link, says nobody is left in it and offers the admin the deletion, not the channel', async () => {
    const calls = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/c/c9`,
      routes: { '/channels/c9': (q, init) => { calls.push(init.method); return json({ ok: true }); } },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    asAdmin(store);
    store.refreshAfterChange = async () => { delete store.ws.channels.c9; store.emit('workspace'); };
    // The real conversation column (the file's stub stands in for it elsewhere).
    const { createConversationView } = await vi.importActual('../src/ui/conversation.js');
    let details = 0;
    const view = createConversationView('c9', { onOpenThread() {}, onOpenDetails: () => details++ });
    document.body.append(view.el);
    await d.tick(5);
    // The header names it and offers no way into details, no topic, no members button.
    expect(view.el.querySelector('.conv-title').textContent).toBe('old-project');
    expect(view.el.querySelector('.conv-title-btn')).toBeNull();
    expect(view.el.querySelector('.conv-topic')).toBeNull();
    expect(view.el.querySelector('.conv-members-btn')).toBeNull();
    expect(view.el.querySelector('textarea')).toBeNull(); // nothing to post with
    expect(view.el.querySelector('h3').textContent).toBe('Nobody is left in #old-project');
    expect(view.el.querySelector('.empty p').textContent).toBe('Its last member left the workspace, so nobody can open it or post in it. As an admin you can delete it, messages and files included.');
    const buttons = [...view.el.querySelectorAll('.empty button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Delete channel', 'Back to channels']);
    expect(calls).toEqual([]); // nothing was read for it: the worker would answer 404
    view.el.querySelector('.btn-danger').click();
    await d.tick(5);
    const confirm = document.querySelector('.modal-root:not(.closing)');
    expect(confirm.querySelector('.modal-title').textContent).toBe('Delete #old-project?');
    confirm.querySelector('.btn-danger').click();
    await d.tick(10);
    expect(calls).toEqual(['DELETE']);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}`); // led back to the channel list
    view.destroy();
  });
});

describe('a scheduled message the server refused at its time', () => {
  it('reads as not sent with the reason and its time, keeps the ways out, stays marked when Send now is refused again, and is armed again by a new time', async () => {
    const { aroundText } = await import('../src/lib/schedule.js');
    // Due times picked twenty-two seconds into a minute: a time read back within a few seconds of a minute is put on it (see the store's _dueHere), and a run that started in those seconds read the moved minute as a fault.
    const onMinute = (delta) => Math.floor(Date.now() / 60_000) * 60_000 + 22_000 + delta;
    const failed = { id: 's1', kind: 'message', u: 'u-me', conv: 'c2', text: 'late news', attachments: [], dueAt: onMinute(-60_000), createdAt: 1, failed: { at: Date.now() - 30_000, code: 'archived', message: 'This channel is archived' } };
    const waiting = { id: 's2', kind: 'message', u: 'u-me', conv: 'c1', text: 'in an hour', attachments: [], dueAt: onMinute(3600_000), createdAt: 2 };
    const puts = [];
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/later`,
      routes: {
        '/scheduled': () => json({ scheduled: [failed, waiting], reminders: [] }),
        '/scheduled/s1': (q, init) => {
          const body = JSON.parse(init.body);
          puts.push(body);
          // The post refused again, as the live one would be: the worker keeps the entry, marked with this reason.
          if (body.sendNow) return json({ code: 'read_only', message: 'Only admins can post in #ops' }, 403);
          return json({ ok: true });
        },
      },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('.view-seg [role="radio"]')[2].click(); // Scheduled
    await d.tick(5);
    expect(store.scheduledCount()).toBe(2); // the badge counts what was not sent as well: it is the author's to act on
    const rows = () => [...view.el.querySelectorAll('.sched-row')];
    expect(rows().length).toBe(2);
    const row = rows()[0]; // past its time, it sorts first
    expect(row.classList.contains('not-sent')).toBe(true);
    expect(row.querySelector('.view-row-kind').textContent).toBe('Not sent');
    expect(row.querySelector('.sched-why').textContent).toBe(`Not sent: This channel is archived. It was to go ${aroundText(failed.dueAt)}.`);
    expect(row.querySelector('.view-row-text').textContent).toBe('late news');
    expect([...row.querySelectorAll('.view-row-actions button')].map((b) => b.textContent)).toEqual(['Edit', 'Reschedule', 'Send now', 'Delete']);
    // The waiting one reads as before.
    expect(rows()[1].classList.contains('not-sent')).toBe(false);
    expect(rows()[1].querySelector('.view-row-kind').textContent).toBe(`Sends ${aroundText(waiting.dueAt)}`);
    expect(rows()[1].querySelector('.sched-why')).toBeNull();
    // Send now, refused: the reason is said in a toast, and the row stays with the new reason.
    [...row.querySelectorAll('.view-row-actions button')].find((b) => b.textContent === 'Send now').click();
    await d.tick(10);
    expect(puts).toEqual([{ sendNow: true }]);
    expect(rows().length).toBe(2);
    expect(rows()[0].querySelector('.sched-why').textContent).toBe(`Not sent: Only admins can post in #ops. It was to go ${aroundText(failed.dueAt)}.`);
    expect([...document.querySelectorAll('.toast')].map((n) => n.querySelector('span').textContent)).toContain('Not sent: Only admins can post in #ops');
    expect(store.scheduledCount()).toBe(2);
    // A new time arms it again: it reads as waiting, sorted to its new place.
    [...rows()[0].querySelectorAll('.view-row-actions button')].find((b) => b.textContent === 'Reschedule').click();
    await d.tick(5);
    document.querySelector('.menu .menu-item').click(); // the first preset
    await d.tick(10);
    expect(puts[1]).toHaveProperty('dueAt');
    expect(puts[1].dueAt).toBeGreaterThan(Date.now());
    expect(view.el.querySelectorAll('.not-sent').length).toBe(0);
    expect(view.el.querySelectorAll('.sched-why').length).toBe(0);
    const byTime = puts[1].dueAt < waiting.dueAt ? ['late news', 'in an hour'] : ['in an hour', 'late news'];
    expect(rows().map((r) => r.querySelector('.view-row-text').textContent)).toEqual(byTime);
    expect([...document.querySelectorAll('.toast')].map((n) => n.querySelector('span').textContent)).toContain(`Moved to ${aroundText(puts[1].dueAt)}`);
    view.destroy();
  });
});

describe('a workspace being moved to another server', () => {
  const WORDS = 'This workspace is being moved to another server. You can read, but nothing can be posted for a few minutes.';

  it('shows a strip under the top bar from the bootstrap on, takes it down when the move is over, and lets the freeze lapse on its own', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    const { TRANSFER_FREEZE_MS } = await import('../src/lib/store.js');
    // The bootstrap carries the freeze: the strip is there as the workspace opens.
    store.openWorkspace = async () => { ctx.open(); store.ws.transferring = { by: 'u-dan', at: store.serverNow() - 60_000 }; store.emit('workspace'); };
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(5);
    const strip = app.querySelector('.transfer-strip');
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.getAttribute('aria-live')).toBe('polite');
    expect(strip.parentElement.classList.contains('app-frame')).toBe(true); // inside the frame, not over the top bar
    expect(strip.previousElementSibling.classList.contains('topbar')).toBe(true);
    expect(strip.nextElementSibling.classList.contains('shell')).toBe(true);
    expect(strip.textContent).toBe(WORDS);
    expect(store.isTransferring()).toBe(true);
    // The move completes: the refresh brings the field cleared, and the strip empties (the live region stays).
    store.ws.transferring = null;
    store.emit('workspace');
    expect(strip.textContent).toBe('');
    expect(strip.isConnected).toBe(true);
    // A freeze that lapses on the worker's clock without any event: the strip goes at that moment.
    store.ws.transferring = { by: 'u-dan', at: store.serverNow() - TRANSFER_FREEZE_MS + 400 };
    store.emit('workspace');
    expect(strip.textContent).toBe(WORDS);
    await d.tick(200);
    expect(strip.textContent).toBe(WORDS);
    await d.tick(700);
    expect(strip.textContent).toBe('');
    expect(store.isTransferring()).toBe(false);
  });

  it('puts the same words in the composer\'s place, in a channel and in a direct message, and gives the box back when the move is over', async () => {
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/c/c1`,
      routes: { '/messages': () => json({ messages: [], seq: 0 }) },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.transferring = { by: 'u-dan', at: store.serverNow() };
    expect(store.postAccess('c1')).toEqual({ ok: false, reason: 'transferring' });
    expect(store.postAccess('dm_h')).toEqual({ ok: false, reason: 'transferring' });
    expect(store.postAccess('c1', { thread: true }).reason).toBe('transferring');
    expect(store.canHuddle('c1')).toBe(false);
    const { createConversationView } = await vi.importActual('../src/ui/conversation.js');
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(10);
    expect(view.el.querySelector('textarea')).toBeNull();
    expect(view.el.querySelector('.composer-blocked').textContent).toBe(WORDS);
    // Over: the next workspace word brings the box back.
    store.ws.transferring = null;
    store.emit('workspace');
    await d.tick(10);
    expect(view.el.querySelector('.composer-blocked')).toBeNull();
    expect(view.el.querySelector('textarea')).not.toBeNull();
    view.destroy();
  });
});

describe('toasts piling up', () => {
  it('keep to four at a time, the oldest leaving early, and never take the one that must not be missed', async () => {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const standing = () => [...document.querySelectorAll('.toast:not(.leaving)')].map((n) => n.querySelector('span').textContent);
    toast('A new version of Teamchat is ready', { duration: Infinity, dismissible: true, action: { label: 'Reload', onClick() {} } });
    for (let i = 1; i <= 6; i++) toast(`Could not send message ${i}`, { icon: 'alert', duration: 60_000 });
    // Six failures at once: the sticky prompt stays, the three oldest failures went, the four newest stand.
    expect(standing()).toEqual(['A new version of Teamchat is ready', 'Could not send message 4', 'Could not send message 5', 'Could not send message 6']);
    expect(document.querySelectorAll('.toast.leaving').length).toBe(3);
    await d.tick(450);
    expect(document.querySelectorAll('.toast').length).toBe(4); // the leaving ones are gone from the page
    // One more takes the place of the oldest failure, not the prompt's.
    toast('Saved', { duration: 60_000 });
    expect(standing()).toEqual(['A new version of Teamchat is ready', 'Could not send message 5', 'Could not send message 6', 'Saved']);
  });
});

describe('the offline strip when the app itself cannot start', () => {
  /** The app booted from main.js with Puter faked: signed in, but the account cannot be read. */
  async function startApp({ online }) {
    dom?.uninstall();
    dom = installDom({ hash: '' });
    vi.resetModules();
    const app = document.createElement('div');
    app.id = 'app';
    app.className = 'app';
    document.body.append(app);
    dom.navigator.onLine = online;
    let asked = 0;
    globalThis.puter = { auth: { isSignedIn: async () => true, getUser: async () => { asked++; throw new TypeError('Failed to fetch'); } }, kv: { get: async () => null } };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('../src/main.js');
    await dom.tick(30);
    return { app, quiet, asked: () => asked };
  }

  it('says the reader is offline over the "Could not load your account" screen, without the note about messages, and clears when the network is back', async () => {
    const { app, quiet } = await startApp({ online: false });
    expect(app.querySelector('.auth-title')?.textContent).toBe('Could not load your account');
    const strip = document.body.firstElementChild;
    expect(strip?.classList.contains('offline-banner')).toBe(true);
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.textContent).toContain('You are offline');
    expect(strip.querySelector('.offline-note')).toBeNull(); // nothing can be sent from here
    dom.navigator.onLine = true;
    window.dispatchEvent(new Event('online'));
    expect(strip.textContent).toBe('');
    await dom.tick(30);
    quiet.mockRestore();
  });

  it('is mounted once, empty, when the network is fine, so the screen is not doubled up', async () => {
    const { app, quiet } = await startApp({ online: true });
    expect(app.querySelector('.auth-title')?.textContent).toBe('Could not load your account');
    expect(document.querySelectorAll('.offline-banner').length).toBe(1);
    expect(document.querySelector('.offline-banner').textContent).toBe('');
    quiet.mockRestore();
  });

  it('asks for the account again on its own when the network comes back to that page, and only then', async () => {
    const { app, quiet, asked } = await startApp({ online: false });
    expect(app.querySelector('.auth-title')?.textContent).toBe('Could not load your account');
    expect(asked()).toBe(1);
    // Still no network on the first try: the page stays, with its Try again.
    window.dispatchEvent(new Event('online'));
    await dom.tick(30);
    expect(asked()).toBe(2);
    expect(app.querySelector('.auth-title')?.textContent).toBe('Could not load your account');
    expect([...app.querySelectorAll('button')].map((b) => b.textContent)).toContain('Try again');
    // The account answers now: the app comes up in the page's place, without a reload.
    globalThis.puter.auth.getUser = async () => { asked(); return { uuid: 'u-me', username: 'me' }; };
    window.dispatchEvent(new Event('online'));
    await dom.tick(50);
    expect(app.querySelector('.auth-title')?.textContent).not.toBe('Could not load your account');
    expect(app.querySelector('.app-frame')).not.toBeNull();
    expect(dom.location.reloads).toBe(0);
    // In the app, the network returning asks for nothing more.
    window.dispatchEvent(new Event('online'));
    await dom.tick(30);
    expect(app.querySelectorAll('.app-frame').length).toBe(1);
    quiet.mockRestore();
  });

  it('leaves the sign-in page alone once a retry has landed there, so a sign-in under way is not started over', async () => {
    const { app, quiet, asked } = await startApp({ online: false });
    expect(app.querySelector('.auth-title')?.textContent).toBe('Could not load your account');
    // The network is back but the session lapsed meanwhile: the retry ends on the sign-in page.
    globalThis.puter.auth.getUser = async () => null;
    globalThis.puter.auth.signOut = async () => {};
    window.dispatchEvent(new Event('online'));
    await dom.tick(30);
    expect(app.querySelector('.auth-title')?.textContent).not.toBe('Could not load your account');
    expect(app.querySelector('.auth-view')).not.toBeNull(); // the sign-in page
    const before = asked();
    // The network flickering again asks for nothing: the page is the reader's to sign in on.
    window.dispatchEvent(new Event('online'));
    await dom.tick(30);
    expect(asked()).toBe(before);
    expect(app.querySelector('.auth-view')).not.toBeNull();
    quiet.mockRestore();
  });
});
