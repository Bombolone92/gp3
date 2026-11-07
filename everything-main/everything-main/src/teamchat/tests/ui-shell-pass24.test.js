/**
 * Twenty-fourth review pass, the shell: the Threads view's cards, the lists
 * and the shell's own controls, driven in node through tests/helpers/dom.js
 * (a small DOM: elements, selectors, bubbling events with capture, focus,
 * matchMedia by viewport and pointer; no CSS), as tests/lead-pass23-ui.test.js
 * drives them: a fresh DOM and a fresh module registry for every test, Puter
 * faked at `puter.workers.exec`, the toast, the theme, the modal layer and
 * navigation mocked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({
  confirmDialog: vi.fn(async () => true),
  closeAllModals: vi.fn(),
  openModal: vi.fn(({ content, onClose }) => {
    document.body.append(content);
    const close = vi.fn(() => { content.remove(); onClose?.(); });
    return { close, panel: content, root: content };
  }),
}));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));
vi.mock('../src/lib/archive.js', async (importOriginal) => ({ ...(await importOriginal()), transferWorkspace: vi.fn() }));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a small workspace open in the store: two channels the member is in and two teammates. */
async function boot({ width = 1280, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ width, ...env });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  const { api } = await import('../src/lib/api.js');
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3, createdBy: 'u2', createdAt: 1_700_000_000_000 }, c2: { id: 'c2', name: 'random', count: 3 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 },
      u3: { role: 'member', name: 'Ben Ito', username: 'ben', color: 3 },
    },
  };
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, api, dom };
}

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  if (store) {
    for (const t of store._readTimers?.values() || []) clearTimeout(t);
    store._readTimers?.clear();
  }
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

/**
 * The Threads view over one thread in #general, its root the given member's,
 * with the given replies already read; the channel's own window holds the
 * root too, as it does once the channel has been opened.
 */
async function openThreads({ rootUser = 'u-me', replies = [], replyCount = replies.length } = {}) {
  const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
  const root = { seq: 1, user: rootUser, ts: 1_700_000_000_001, text: 'root 1', kind: 'msg', replyCount, attachments: [], mentions: [], reactions: {} };
  globalThis.puter.workers.exec = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
    if (u.pathname.endsWith('/messages')) return json({ messages: replies, seq: replies.length });
    return json({ code: 'not_found', message: 'nope' }, 404);
  };
  Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [{ ...root }] });
  const { createListView } = await import('../src/ui/views.js');
  const v = createListView('threads');
  document.body.append(v.el);
  await d.tick(10);
  const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
  expect(card).toBeTruthy();
  return { d, v, card };
}

const reply = (seq, user = 'u3') => ({ seq, user, ts: 1_700_000_000_001 + seq, text: `r${seq}`, kind: 'msg', attachments: [], mentions: [], reactions: {} });

/** Edit message picked from the row's menu; the edit box, focused. */
async function editFromMenu(d, row) {
  row.querySelector('[aria-label="More actions"]').click();
  await d.tick(1);
  [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Edit message')).click();
  await d.tick(1);
  const input = row.querySelector('.msg-edit-input');
  expect(input).toBeTruthy();
  expect(document.activeElement).toBe(input);
  return input;
}

describe('an edit standing open on a Threads view card while the keyboard is elsewhere, when the card is drawn again', () => {
  it('keeps the box and its words, and leaves the keyboard where it was (a box outside the card), rather than pulling it into the edit', async () => {
    const { d, v, card } = await openThreads();
    const input = await editFromMenu(d, card.querySelector('.msg.thread-root'));
    input.value = 'root 1, and more';
    // The reader has gone on to something else with the edit still open: the
    // sidebar's filter box, say (any control outside the card).
    const elsewhere = document.createElement('input');
    elsewhere.setAttribute('aria-label', 'Filter conversations');
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
    // A message lands in the channel: the card draws its rows anew under the edit.
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    const again = card.querySelector('.msg.thread-root .msg-edit-input');
    expect(again).toBeTruthy();
    expect(again).not.toBe(input);
    expect(again.value).toBe('root 1, and more');
    expect(document.activeElement).toBe(elsewhere);
    // And for a reply landing in the thread.
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    expect(card.querySelector('.msg.thread-root .msg-edit-input').value).toBe('root 1, and more');
    expect(document.activeElement).toBe(elsewhere);
    v.destroy();
  });

  it('leaves the keyboard in another card\'s reply box, mid-word', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    const rootOf = (seq, user) => ({ seq, user, ts: 1_700_000_000_000 + seq, text: `root ${seq}`, kind: 'msg', replyCount: 0, attachments: [], mentions: [], reactions: {} });
    const roots = { 1: rootOf(1, 'u-me'), 2: rootOf(2, 'u2') };
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [1, 2].map((seq) => ({ id: `c1_t${seq}`, conv: 'c1', seq, at: 5000 + seq, unread: 0, root: roots[seq] })) });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [{ ...roots[1] }, { ...roots[2] }] });
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const mine = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    const other = v.el.querySelector('.thread-card[data-thread="c1_t2"]');
    expect(mine && other).toBeTruthy();
    const input = await editFromMenu(d, mine.querySelector('.msg.thread-root'));
    input.value = 'root 1, and more';
    // Typing a reply into the other thread's box, the edit left open.
    const box = other.querySelector('textarea');
    expect(box).toBeTruthy();
    box.focus();
    expect(document.activeElement).toBe(box);
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    expect(mine.querySelector('.msg.thread-root .msg-edit-input').value).toBe('root 1, and more');
    expect(document.activeElement).toBe(box);
    v.destroy();
  });

  it('puts the keyboard that was on the edit\'s Save or Cancel on the row itself when the box cannot come back, not on whatever stands at its place (a reaction pill)', async () => {
    const { toast } = await import('../src/ui/toast.js');
    const { d, v, card } = await openThreads();
    // The root carries reactions: controls that follow the edit box in the row.
    const m = store.conv('c1').messages.find((x) => x.seq === 1);
    m.reactions = { '+1': { u2: 1_700_000_000_005 }, eyes: { u3: 1_700_000_000_006 } };
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    const old = card.querySelector('.msg.thread-root');
    expect(old.querySelectorAll('.reaction:not(.reaction-add)')).toHaveLength(2);
    const input = await editFromMenu(d, old);
    input.value = 'root 1, and more';
    // Tabbed from the box onto Save.
    const save = [...old.querySelectorAll('.msg-edit-actions button')].find((b) => b.textContent === 'Save');
    save.focus();
    expect(document.activeElement).toBe(save);
    // The channel is archived meanwhile: nothing can be edited there now, and the box cannot come back.
    store.ws.channels.c1.archived = true;
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    const fresh = card.querySelector('.msg.thread-root');
    expect(fresh).not.toBe(old);
    expect(fresh.querySelector('.msg-edit')).toBeNull();
    expect(toast).toHaveBeenCalledWith('Editing stopped: nothing can be changed here now', expect.anything());
    // The keyboard is on the row, where the message is, not on a reaction pill a Space away from toggling it.
    expect(document.activeElement).toBe(fresh);
    v.destroy();
  });

  it('still brings the keyboard back to the box when it was there (as before)', async () => {
    const { d, v, card } = await openThreads();
    const input = await editFromMenu(d, card.querySelector('.msg.thread-root'));
    input.value = 'root 1, and more';
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    const again = card.querySelector('.msg.thread-root .msg-edit-input');
    expect(again).not.toBe(input);
    expect(document.activeElement).toBe(again);
    v.destroy();
  });
});

describe('the keyboard on a control of a Threads view card outside its rows while the card is drawn again', () => {
  it('stays on the same control (Open thread, Show more replies, the channel\'s name), not the card\'s first button', async () => {
    const { d, v, card } = await openThreads({ rootUser: 'u2', replies: [reply(1), reply(2), reply(3), reply(4), reply(5)], replyCount: 5 });
    const byText = (text) => [...card.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
    expect(byText('Show 2 more')).toBeTruthy();
    for (const label of ['Open thread', 'Show 2 more', 'general']) {
      const btn = byText(label);
      expect(btn, label).toBeTruthy();
      btn.focus();
      expect(document.activeElement).toBe(btn);
      store.emit('messages', { conv: 'c1', reason: 'poll' });
      await d.tick(2);
      const fresh = byText(label);
      expect(fresh, label).toBeTruthy();
      expect(fresh).not.toBe(btn);
      expect(document.activeElement, label).toBe(fresh);
    }
    // A control whose words moved with the redraw (a reply landing: "Show 3 more replies") is the same control still.
    const more = byText('Show 2 more');
    more.focus();
    store.conv('c1_t1').messages.push(reply(6));
    store.emit('messages', { conv: 'c1_t1', reason: 'poll' });
    await d.tick(2);
    expect(byText('Show 3 more')).toBeTruthy();
    expect(document.activeElement).toBe(byText('Show 3 more'));
    // A control inside a row is found as before (the root's More actions, by its name).
    const rootMore = card.querySelector('.msg.thread-root [aria-label="More actions"]');
    rootMore.focus();
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    expect(document.activeElement).not.toBe(rootMore);
    expect(document.activeElement).toBe(card.querySelector('.msg.thread-root [aria-label="More actions"]'));
    v.destroy();
  });
});

describe('a search filter that cannot be read', () => {
  /** The search view over the query, its notice text once drawn. */
  async function noticeFor(query) {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/search/${encodeURIComponent(query)}` });
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView(query, { onQuery() {} });
    document.body.append(view.el);
    await d.tick(10);
    const text = view.el.querySelector('.empty p')?.textContent || '';
    const heading = view.el.querySelector('.empty h3')?.textContent || '';
    view.destroy();
    return { text, heading };
  }

  it('says what has: takes for a typo in it (has:lnk), not that dates look like 2026-03-01', async () => {
    const { text, heading } = await noticeFor('plan has:lnk');
    expect(heading).toBe('Check the filter');
    expect(text).toContain('has:lnk');
    expect(text).toMatch(/has: takes file or link/);
    expect(text).not.toMatch(/Dates look like/);
  });

  it('still says how dates look for a date that cannot be read, and both for both', async () => {
    const a = await noticeFor('plan before:yesterday');
    expect(a.text).toContain('before:yesterday');
    expect(a.text).toMatch(/Dates look like 2026-03-01/);
    expect(a.text).not.toMatch(/has: takes/);
    const b = await noticeFor('plan has:pictures after:soon');
    expect(b.text).toContain('has:pictures');
    expect(b.text).toContain('after:soon');
    expect(b.text).toMatch(/has: takes file or link/);
    expect(b.text).toMatch(/Dates look like 2026-03-01/);
  });
});

describe('a sidebar section renamed while the account write is out and another workspace is opened meanwhile', () => {
  it('is renamed in the workspace it belongs to, and nothing is written for the other', async () => {
    await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const OTHER = 'ffff000000@teamchat-test';
    store.profile.prefs.sections = { [REF]: [{ id: 's1', name: 'Projects', items: ['c2'] }], [OTHER]: [{ id: 's9', name: 'Elsewhere', items: [] }] };
    // The account's document, read afresh and written by the store: the switch lands while it is being read.
    let written = null;
    store._mutateUser = async (fn) => {
      await new Promise((r) => setTimeout(r, 5));
      store.wsId = OTHER;
      const doc = { prefs: structuredClone(store.profile.prefs) };
      fn(doc);
      written = doc;
    };
    await store.renameSection('s1', 'Clients');
    expect(written.prefs.sections[REF]).toEqual([{ id: 's1', name: 'Clients', items: ['c2'] }]);
    expect(written.prefs.sections[OTHER]).toEqual([{ id: 's9', name: 'Elsewhere', items: [] }]);
    // This tab's own copy, redrawn at once, has the rename under the same workspace.
    expect(store.profile.prefs.sections[REF][0].name).toBe('Clients');
    expect(store.profile.prefs.sections[OTHER][0].name).toBe('Elsewhere');
  });
});

describe('a direct message in the sidebar with someone who has left the workspace', () => {
  it('keeps their name on the row, said without a presence (they have none), and opens as any row does', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    store.me.dms = { dm_gone: { members: ['u-me', 'u-gone'], createdAt: 3 } };
    store.ws.former = { 'u-gone': { name: 'Old Friend', username: 'old' } };
    store.act.c.dm_gone = { s: 2, t: 1000 };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await d.tick(5);
    const row = [...nav.querySelectorAll('.side-row > .side-item')].find((a) => /Old Friend/.test(a.getAttribute('aria-label') || ''));
    expect(row).toBeTruthy();
    expect(row.getAttribute('aria-label')).toBe('Old Friend, 2 unread');
    expect(row.querySelector('.side-label').textContent).toBe('Old Friend');
    expect(row.querySelector('.avatar .avatar-img')).toBeNull(); // no photo is fetched for someone gone
    // The filter finds them too, by the name kept on the card.
    d.type(nav.querySelector('.side-filter-input'), 'old');
    expect([...nav.querySelectorAll('.side-results .side-item')].some((a) => /Old Friend/.test(a.getAttribute('aria-label') || ''))).toBe(true);
  });
});

describe('the Later view and the store\'s half-minute reuse of a server\'s lists', () => {
  it('opened again within the half minute shows a save made in another tab meanwhile; Done on a reminder lowers the badge, and a host\'s later read does not bring it back', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/later` });
    const m = (seq) => ({ seq, user: 'u2', ts: 1_700_000_000_000 + seq, text: `m${seq}`, kind: 'msg', attachments: [], mentions: [], reactions: {} });
    let saved = [{ c: 'c1', s: 1, ts: 1000, done: false, message: m(1) }];
    let reminders = [{ id: 'r1', kind: 'reminder', conv: 'c1', seq: 1, dueAt: Date.now() + 3_600_000, note: 'call back', message: m(1) }];
    const calls = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      calls.push(`${init.method || 'GET'} ${u.pathname}`);
      if (u.pathname.endsWith('/saved')) return json({ items: saved });
      if (u.pathname.endsWith('/scheduled') && (init.method || 'GET') === 'GET') return json({ scheduled: [], reminders });
      if (/\/scheduled\/r1$/.test(u.pathname) && init.method === 'DELETE') { reminders = []; return json({ ok: true }); }
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const { createListView } = await import('../src/ui/views.js');
    let view = createListView('later');
    document.body.append(view.el);
    await d.tick(10);
    expect(view.el.querySelectorAll('.later-row')).toHaveLength(1);
    view.destroy();
    view.el.remove();
    // Another tab saves a second message; the view opened here again within the half minute reads afresh.
    saved = [...saved, { c: 'c1', s: 2, ts: 2000, done: false, message: m(2) }];
    view = createListView('later');
    document.body.append(view.el);
    await d.tick(10);
    expect(view.el.querySelectorAll('.later-row')).toHaveLength(2);
    expect(calls.filter((c) => c.endsWith('/saved'))).toHaveLength(2);
    // Reminders: one, counted; Done takes it off the list and the badge.
    [...view.el.querySelectorAll('[role="radio"]')].find((r) => r.textContent === 'Reminders').click();
    await d.tick(10);
    expect(view.el.querySelectorAll('.later-row')).toHaveLength(1);
    expect(store.reminderCount()).toBe(1);
    view.el.querySelector('[aria-label="Done, remove reminder"]').click();
    await d.tick(10);
    expect(view.el.querySelectorAll('.later-row')).toHaveLength(0);
    expect(store.reminderCount()).toBe(0);
    // A host's link arriving now reads with reuse: the list read a moment ago is not served for the change made here.
    await store.loadScheduled({ reuse: true });
    expect(store.reminderCount()).toBe(0);
    view.destroy();
  });
});

describe('the shell\'s letter shortcuts during an input method\'s composition', () => {
  it('do not fire for the confirming key of a composition (isComposing, or Safari\'s keyCode 229), and fire otherwise, from a text field too', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const opened = vi.fn();
    vi.doMock('../src/ui/dialogs.js', async (importOriginal) => ({ ...(await importOriginal()), newDmDialog: opened }));
    const { installShortcuts } = await import('../src/ui/shortcuts.js');
    installShortcuts({ toggleShortcuts() {}, closePanel() {} });
    const field = document.createElement('textarea');
    document.body.append(field);
    field.focus();
    const press = (init) => {
      const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...init });
      field.dispatchEvent(e);
      return e;
    };
    // Mid-composition: the key is the input method's, and passes untouched.
    expect(press({ isComposing: true }).defaultPrevented).toBe(false);
    expect(press({ keyCode: 229 }).defaultPrevented).toBe(false);
    expect(opened).not.toHaveBeenCalled();
    // The same keys outside a composition open New message, from the field as from anywhere.
    expect(press({}).defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
    await d.tick(1);
    vi.doUnmock('../src/ui/dialogs.js');
  });
});

/**
 * A message row's hover bar as the stylesheet draws it: the bar is drawn
 * only while the row is under the pointer or holds the keyboard, or while
 * its menu stands (`.msg:hover .msg-actions, .msg:focus-within .msg-actions,
 * .msg.menu-open .msg-actions { display: flex }`, app.css), and a browser
 * will not focus a control that is not drawn. Modelled here by `hidden` on
 * the bar, toggled with the row's focus, on every row renderMessage draws
 * (as tests/lead-pass22-ui.test.js models one row), since the fake DOM knows
 * `hidden` but no stylesheet. Registered for one test and taken off after it.
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

describe('the keyboard on a button of a message\'s hover bar in a Threads view card, the bar drawn only while its row holds the keyboard', () => {
  it('lands on the same button of the fresh row, through the row (which draws the bar), not on the page', async () => {
    hoverBarsAsDrawn();
    const { d, v, card } = await openThreads({ rootUser: 'u2', replies: [reply(1)], replyCount: 1 });
    const replyRow = () => card.querySelector('.msg:not(.thread-root)');
    const bar = () => replyRow().querySelector('.msg-actions');
    // Nobody on the row: its bar is not drawn.
    expect(bar().hidden).toBe(true);
    // Tabbed onto the row, then into its bar, onto More actions.
    replyRow().focus();
    expect(bar().hidden).toBe(false);
    const more = replyRow().querySelector('[aria-label="More actions"]');
    more.focus();
    expect(document.activeElement).toBe(more);
    // A reply lands: the card draws its rows anew, the fresh row's bar not drawn until the row holds the keyboard.
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    expect(replyRow().querySelector('[aria-label="More actions"]')).not.toBe(more);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(replyRow().querySelector('[aria-label="More actions"]'));
    expect(bar().hidden).toBe(false);
    // And a message landing in the channel, from the root's bar.
    const rootRow = () => card.querySelector('.msg.thread-root');
    rootRow().focus();
    rootRow().querySelector('[aria-label="More actions"]').focus();
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    expect(document.activeElement).toBe(rootRow().querySelector('[aria-label="More actions"]'));
    v.destroy();
    vi.doUnmock('../src/ui/message.js');
  });
});

