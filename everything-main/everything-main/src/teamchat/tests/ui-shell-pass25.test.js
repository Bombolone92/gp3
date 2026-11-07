/**
 * Twenty-fifth review pass, the shell: the Threads view's cards, the lists
 * and the sidebar, driven in node through tests/helpers/dom.js (a small DOM:
 * elements, selectors, bubbling events with capture, focus, matchMedia by
 * viewport and pointer; no CSS), as tests/ui-shell-pass24.test.js drives
 * them: a fresh DOM and a fresh module registry for every test, Puter faked
 * at `puter.workers.exec`, the toast, the theme, the modal layer and
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

const rootOf = (seq, user) => ({ seq, user, ts: 1_700_000_000_000 + seq, text: `root ${seq}`, kind: 'msg', replyCount: 0, attachments: [], mentions: [], reactions: {} });

/**
 * The Threads view over two threads in #general (the first the reader's own,
 * the second Ana's), the channel's window holding both roots. The threads
 * list the worker answers can be changed between reads (`threads.list`).
 */
async function openThreads() {
  const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
  const roots = { 1: rootOf(1, 'u-me'), 2: rootOf(2, 'u2') };
  const threads = { list: [1, 2].map((seq) => ({ id: `c1_t${seq}`, conv: 'c1', seq, at: 5000 + seq, unread: 0, root: roots[seq] })), reads: 0 };
  globalThis.puter.workers.exec = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/threads')) { threads.reads++; return json({ threads: threads.list }); }
    if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
    return json({ code: 'not_found', message: 'nope' }, 404);
  };
  Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [{ ...roots[1] }, { ...roots[2] }] });
  const { createListView } = await import('../src/ui/views.js');
  const v = createListView('threads');
  document.body.append(v.el);
  await d.tick(10);
  // The first poll after the view opened sets the counts the view compares later ones against.
  store.emit('workspace');
  await d.tick(2);
  const card = (seq) => v.el.querySelector(`.thread-card[data-thread="c1_t${seq}"]`);
  expect(card(1) && card(2)).toBeTruthy();
  return { d, v, card, threads, roots };
}

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

/** The sidebar alone, mounted on a fresh element, at the given width. */
async function mountSidebar({ width = 600 } = {}) {
  const { dom: d } = await boot({ width, hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
  const { renderSidebar } = await import('../src/ui/sidebar.js');
  const el = document.createElement('nav');
  document.body.append(el);
  const side = renderSidebar(el);
  await d.tick(2);
  return { d, el, side };
}

describe('the keyboard on the sidebar footer\'s bell (shown on a phone) as notifications are paused from its menu', () => {
  it('stays on the bell through the redraw that renames it ("Notifications paused. Change"), and on the reader\'s card likewise', async () => {
    const { d, el } = await mountSidebar();
    const bell = el.querySelector('.side-footer [aria-label="Pause notifications"]');
    expect(bell).toBeTruthy();
    bell.focus();
    expect(document.activeElement).toBe(bell);
    // The pause lands on the profile (the menu's pick wrote it): the footer is drawn again with the new names.
    store.profile.prefs.pauseUntil = Date.now() + 60_000;
    store.emit('profile');
    await d.tick(2);
    const again = el.querySelector('.side-footer [aria-label^="Notifications paused"]');
    expect(again).toBeTruthy();
    expect(again).not.toBe(bell);
    expect(document.activeElement).toBe(again);
    // Resumed, with the keyboard on the reader's own card, whose name carried the pause.
    const me = el.querySelector('.side-footer .side-me');
    expect(me.getAttribute('aria-label')).toContain('Notifications paused');
    me.focus();
    store.profile.prefs.pauseUntil = null;
    store.emit('profile');
    await d.tick(2);
    const meAgain = el.querySelector('.side-footer .side-me');
    expect(meAgain).not.toBe(me);
    expect(meAgain.getAttribute('aria-label')).toBe('Your profile and settings');
    expect(document.activeElement).toBe(meAgain);
  });
});

describe('the Direct messages list while messages land in a channel', () => {
  it('keeps its rows as they are (nothing on them moved), and draws them afresh for a direct message\'s own news', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/dms` });
    store.me.dms = { dm_a: { members: ['u-me', 'u2'], createdAt: 3 }, dm_b: { members: ['u-me', 'u3'], createdAt: 2 } };
    for (const id of ['dm_a', 'dm_b']) {
      Object.assign(store.conv(id), { loaded: true, seq: 1, messages: [{ seq: 1, user: 'u2', ts: 1000, text: `hi from ${id}`, kind: 'msg', attachments: [], mentions: [], reactions: {} }] });
      store.act.c[id] = { s: 1, t: 1000 };
    }
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await d.tick(5);
    const rows = () => [...pane.el.querySelectorAll('.pane-row')];
    const before = rows();
    expect(before).toHaveLength(2);
    // A poll brings new messages in #general, and a reply lands in one of its threads.
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    store.emit('messages', { conv: 'c1_t4', reason: 'local' });
    await d.tick(5);
    const kept = rows();
    expect(kept).toHaveLength(2);
    expect(kept.every((r, i) => r === before[i])).toBe(true);
    // A direct message's own news redraws its list.
    store.conv('dm_a').messages.push({ seq: 2, user: 'u2', ts: 2000, text: 'and more', kind: 'msg', attachments: [], mentions: [], reactions: {} });
    store.emit('messages', { conv: 'dm_a', reason: 'poll' });
    await d.tick(5);
    const after = rows();
    expect(after).toHaveLength(2);
    expect(after[0]).not.toBe(before[0]);
    expect(after.map((r) => r.querySelector('.pane-row-text span').textContent)).toContain('and more');
    pane.destroy();
  });
});

describe('the Files & links list of a conversation while a listed message is deleted or edited here', () => {
  const file = (id, name) => ({ id, name, type: 'application/pdf', size: 1000 });
  // As the index answers them: each hit names its conversation.
  const msg = (seq, extra) => ({ conv: 'c1', seq, user: 'u2', ts: 1_700_000_000_000 + seq, kind: 'msg', text: '', attachments: [], mentions: [], reactions: {}, ...extra });

  /** The Files tab over #general, whose index lists a file at message 1 and a link at message 2. */
  async function openFiles() {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1/files` });
    const messages = [msg(1, { attachments: [file('f1', 'plan.pdf')] }), msg(2, { text: 'see https://example.com/spec for the spec' })];
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: messages.map((m) => ({ ...m })) });
    store.act.c.c1 = { s: 2, t: 1000 };
    const searches = [];
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/search')) {
        searches.push(u.searchParams.get('has'));
        const has = u.searchParams.get('has');
        return json({ results: has === 'file' ? [messages[0]] : has === 'link' ? [messages[1]] : [], cursor: null, hasMore: false, indexed: true });
      }
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const { createFilesView } = await import('../src/ui/filesview.js');
    const v = createFilesView('c1');
    document.body.append(v.el);
    await d.tick(10);
    const rows = () => [...v.el.querySelectorAll('.files-row')].map((r) => r.querySelector('.files-text strong').textContent);
    // Newest first: the link's message came after the file's.
    expect(rows()).toEqual(['https://example.com/spec', 'plan.pdf']);
    return { d, v, rows, searches };
  }

  it('drops the file\'s row when its message is deleted (the counter does not move for a deletion, so no page is read again)', async () => {
    const { d, v, rows, searches } = await openFiles();
    const n = searches.length;
    const m = store.conv('c1').messages.find((x) => x.seq === 1);
    m.deleted = true;
    m.attachments = [];
    store.emit('messages', { conv: 'c1', reason: 'local' });
    await d.tick(10);
    expect(rows()).toEqual(['https://example.com/spec']);
    expect(searches.length).toBe(n);
    v.destroy();
  });

  it('drops the link\'s row when its message is edited to no longer carry the link', async () => {
    const { d, v, rows } = await openFiles();
    const m = store.conv('c1').messages.find((x) => x.seq === 2);
    m.text = 'see the spec';
    store.emit('messages', { conv: 'c1', reason: 'local' });
    await d.tick(10);
    expect(rows()).toEqual(['plan.pdf']);
    v.destroy();
  });
});

describe('a profile opened from a Directory card by the keyboard and closed with Escape', () => {
  it('hands the keyboard back to the card\'s button, not to the page', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const v = createDirectoryView();
    document.body.append(v.el);
    await d.tick(5);
    const open = [...v.el.querySelectorAll('.dir-card-main')].find((b) => /Ana Rocha/.test(b.getAttribute('aria-label')));
    expect(open).toBeTruthy();
    open.focus();
    expect(document.activeElement).toBe(open);
    open.click();
    await d.tick(2);
    const pop = document.querySelector('.menu');
    expect(pop).toBeTruthy();
    expect(pop.textContent).toContain('@ana');
    expect(pop.contains(document.activeElement)).toBe(true);
    d.key(document.activeElement, 'Escape');
    await d.tick(2);
    expect(document.querySelector('.menu')).toBeNull();
    expect(document.activeElement).toBe(open);
    v.destroy();
  });
});

/** The sidebar's rows by section heading: { 'Channels': ['c1', 'c2'], ... }, from the hrefs of the rows the layout shows. */
async function sectionsDrawn(el) {
  const { parseHash } = await import('../src/lib/router.js');
  const out = {};
  for (const sec of el.querySelectorAll('.side-section')) {
    const title = sec.querySelector('.side-title-text').textContent;
    out[title] = [...sec.querySelectorAll('.side-row > .side-item')].filter((a) => !a.closest('.side-row').hidden).map((a) => parseHash(a.getAttribute('href')).conv);
  }
  return out;
}

describe('a custom section of the sidebar through its life', () => {
  it('holds the channel moved into it, gives the channel back to Channels when deleted, and stands empty (collapsible, with its hint) while it has nothing', async () => {
    const { d, el } = await mountSidebar({ width: 1280 });
    store.profile.prefs.sections = { [REF]: [{ id: 's1', name: 'Team', items: ['c2'] }] };
    store.emit('profile');
    await d.tick(2);
    let drawn = await sectionsDrawn(el);
    expect(drawn.Team).toEqual(['c2']);
    expect(drawn.Channels).toEqual(['c1']);
    // The channel is deleted from the workspace: the section stands, empty, with its hint, and folds.
    delete store.ws.channels.c2;
    store.me.channels = ['c1'];
    store.emit('workspace');
    await d.tick(2);
    drawn = await sectionsDrawn(el);
    expect(drawn.Team).toEqual([]);
    const team = [...el.querySelectorAll('.side-section')].find((s) => s.querySelector('.side-title-text').textContent === 'Team');
    expect(team.querySelector('.side-hint').textContent).toMatch(/Drag conversations here/);
    const toggle = team.querySelector('.side-title');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(team.querySelector('.side-hint').hidden).toBe(true);
    // The channel comes back and the section is deleted: the channel is under Channels again, as the dialog promises.
    store.ws.channels.c2 = { id: 'c2', name: 'random', count: 3 };
    store.me.channels = ['c1', 'c2'];
    store.profile.prefs.sections = { [REF]: [] };
    store.emit('profile');
    await d.tick(2);
    drawn = await sectionsDrawn(el);
    expect(drawn.Team).toBeUndefined();
    expect(drawn.Channels).toEqual(['c1', 'c2']);
  });

  it('keeps a row being dragged on the page through a poll\'s redraw, and draws the list afresh once the drag ends', async () => {
    const { d, el } = await mountSidebar({ width: 1280 });
    const { parseHash } = await import('../src/lib/router.js');
    store.profile.prefs.sections = { [REF]: [{ id: 's1', name: 'Team', items: [] }] };
    store.emit('profile');
    await d.tick(2);
    const rowFor = (conv) => [...el.querySelectorAll('.side-row > .side-item')].find((a) => parseHash(a.getAttribute('href')).conv === conv);
    const row = rowFor('c2');
    const dt = { types: [], data: {}, effectAllowed: '', dropEffect: '', setData(t, v) { this.types.push(t); this.data[t] = v; }, getData(t) { return this.data[t] || ''; } };
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    expect(row.classList.contains('dragging')).toBe(true);
    // A poll lands mid-drag: the list is not drawn again under the pointer.
    store.emit('activity');
    await d.tick(2);
    expect(rowFor('c2')).toBe(row);
    // Dropped on the section: the move is asked of the store; the drag ends, and the list is drawn afresh.
    const moved = vi.spyOn(store, 'moveToSection').mockResolvedValue(undefined);
    const team = [...el.querySelectorAll('.side-section')].find((s) => s.querySelector('.side-title-text').textContent === 'Team');
    team.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    expect(moved).toHaveBeenCalledWith('c2', 's1');
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await d.tick(2);
    expect(rowFor('c2')).not.toBe(row);
    expect(el.querySelector('.sidebar-scroll').classList.contains('drag-active')).toBe(false);
    expect(el.querySelector('.side-item.dragging')).toBeNull();
  });
});

describe('the sidebar\'s filter box and row names, as they stand', () => {
  it('takes a character that means something in a pattern ("(", "[", "*") as a letter, and offers a message search for it', async () => {
    const { d, el } = await mountSidebar({ width: 1280 });
    const input = el.querySelector('.side-filter-input');
    for (const q of ['(', 'ran[', 'a*b', '\\']) {
      d.type(input, q);
      await d.tick(1);
      expect(el.querySelector('.side-empty')?.textContent).toBe(`Nothing called “${q}”`);
      expect(el.querySelector('.side-search-row .side-label').textContent).toBe(`Search messages for “${q}”`);
    }
    // A prefix as the app writes names still finds the row.
    d.type(input, '#ran');
    await d.tick(1);
    expect([...el.querySelectorAll('.side-results .side-item')].map((a) => a.querySelector('.side-label').textContent)).toEqual(['random']);
    d.type(input, '@ana');
    await d.tick(1);
    expect([...el.querySelectorAll('.side-results .side-item')].map((a) => a.querySelector('.side-label').textContent)).toEqual(['Ana Rocha']);
  });

  it('marks the parent channel\'s row as the open one while a thread of it is open, and a group conversation\'s row is named by its people alone', async () => {
    const { dom: d } = await boot({ width: 1280, hash: `#/ws/${encodeURIComponent(REF)}/c/c2/t/5` });
    store.me.dms = { dm_g: { members: ['u-me', 'u2', 'u3'], createdAt: 3 } };
    store.act.p = { u2: Date.now() - 60_000 };
    store.ws.members.u3.status = { emoji: '🏖️', text: 'On vacation', until: null };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const el = document.createElement('nav');
    document.body.append(el);
    renderSidebar(el);
    await d.tick(2);
    const { parseHash } = await import('../src/lib/router.js');
    const rowFor = (conv) => [...el.querySelectorAll('.side-row > .side-item')].find((a) => parseHash(a.getAttribute('href')).conv === conv);
    expect(rowFor('c2').getAttribute('aria-current')).toBe('page');
    expect(rowFor('c1').getAttribute('aria-current')).toBeNull();
    expect(rowFor('dm_g').getAttribute('aria-label')).toBe('Ana Rocha, Ben Ito');
  });
});

describe('what a folded sidebar section keeps in view (the unread and the open rows)', () => {
  it('a muted channel with a mention, a channel marked unread by hand, and a direct message whose one unread line is a reminder; not a read row', async () => {
    const { d, el } = await mountSidebar({ width: 1280 });
    const { parseHash } = await import('../src/lib/router.js');
    store.ws.channels.c3 = { id: 'c3', name: 'ops', count: 2 };
    store.me.channels = ['c1', 'c2', 'c3'];
    store.me.dms = { dm_a: { members: ['u-me', 'u2'], createdAt: 3 } };
    // #random: muted, one mention waiting. #ops: read to its end, then marked unread from its last message. Ana: one reminder line, unread.
    store.me.notify = { c2: { mute: true } };
    store.me.mentions = { c2: 1 };
    store.act.c = { c1: { s: 4, t: 1 }, c2: { s: 4, t: 2 }, c3: { s: 4, t: 3 }, dm_a: { s: 1, t: 4 } };
    store.me.reads = { c1: 4, c2: 4, c3: 4, dm_a: 0 };
    Object.assign(store.conv('dm_a'), { loaded: true, seq: 1, messages: [{ seq: 1, user: 'u-me', by: 'sys', kind: 'rem', ts: 1000, text: 'Reminder: call back', attachments: [], mentions: [], reactions: {} }] });
    localStorage.setItem('teamchat:collapsed', JSON.stringify({ channels: true, dms: true }));
    await store.markUnread('c3', 4).catch(() => {});
    store.emit('workspace');
    await d.tick(2);
    const shown = (conv) => !([...el.querySelectorAll('.side-row > .side-item')].find((a) => parseHash(a.getAttribute('href')).conv === conv).closest('.side-row').hidden);
    expect(shown('c1')).toBe(true); // open
    expect(shown('c2')).toBe(true); // muted, but a mention badge
    expect(shown('c3')).toBe(true); // marked unread by hand
    expect(shown('dm_a')).toBe(true); // a reminder line, unread by design
    // A read channel folds away.
    store.me.reads.c3 = 4;
    store._localSeen.set('c3', 4);
    store.emit('workspace');
    await d.tick(2);
    expect(shown('c3')).toBe(false);
  });
});

/** Waits until `cond` holds, or fails after `ms`. */
async function until(d, cond, ms = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await d.tick(5);
  }
}

describe('an edit standing open on a Threads view card when the whole list is read again (a reply landing in another followed thread moved its count)', () => {
  it('keeps the box, its words and the caret through the quiet reload, rather than dropping the edit with the card', async () => {
    const { d, v, card, threads } = await openThreads();
    const input = await editFromMenu(d, card(1).querySelector('.msg.thread-root'));
    input.value = 'root 1, and more';
    input.dispatchEvent(new Event('input'));
    // A reply lands in the second thread on another device: its unread count
    // moves, and the view reads the list again, quietly.
    threads.list[1] = { ...threads.list[1], unread: 1, at: 9000 };
    threads.list.reverse();
    store.me.threads = { c1_t2: 1 };
    const reads = threads.reads;
    store.emit('workspace');
    await until(d, () => threads.reads > reads);
    await d.tick(20);
    // The list is drawn afresh in the worker's order, the busier thread first.
    const cards = [...v.el.querySelectorAll('.thread-card')].map((c) => c.dataset.thread);
    expect(cards).toEqual(['c1_t2', 'c1_t1']);
    expect(card(2).querySelector('.badge')?.textContent).toBe('1 new');
    // The edit stands on the reader's own root, with its words and the keyboard.
    const again = card(1).querySelector('.msg.thread-root .msg-edit-input');
    expect(again, 'the edit box went with the redraw').toBeTruthy();
    expect(again.value).toBe('root 1, and more');
    expect(document.activeElement).toBe(again);
    v.destroy();
  });

  it('leaves the keyboard in another card\'s reply box, mid-word, and drops the card of a thread no longer listed', async () => {
    const { d, v, card, threads } = await openThreads();
    const input = await editFromMenu(d, card(1).querySelector('.msg.thread-root'));
    input.value = 'root 1, and more';
    // Typing a reply into the other thread's box, the edit left open; a code
    // block of the second root unfolded to be read.
    const box = card(2).querySelector('textarea');
    expect(box).toBeTruthy();
    box.focus();
    expect(document.activeElement).toBe(box);
    // The list comes back the other way round, with a third thread the reader
    // has just been made to follow, and the first thread no longer on it.
    const third = { id: 'c1_t3', conv: 'c1', seq: 3, at: 12_000, unread: 2, root: rootOf(3, 'u3') };
    store.conv('c1').messages.push({ ...third.root });
    threads.list = [third, { ...threads.list[1], at: 9000 }];
    store.me.threads = { c1_t3: 2 };
    const reads = threads.reads;
    store.emit('workspace');
    await until(d, () => threads.reads > reads);
    await d.tick(20);
    expect([...v.el.querySelectorAll('.thread-card')].map((c) => c.dataset.thread)).toEqual(['c1_t3', 'c1_t2']);
    expect(card(1)).toBeNull();
    expect(card(3).classList.contains('unread')).toBe(true);
    // The same reply box, the keyboard still in it.
    expect(card(2).querySelector('textarea')).toBe(box);
    expect(document.activeElement).toBe(box);
    v.destroy();
  });

  it('keeps the keyboard on a card\'s own control (Open thread) while the card is moved up the list', async () => {
    const { d, v, card, threads } = await openThreads();
    // The second card's Open thread: the reload lists its thread first, so the
    // card is lifted out of the list and put back above the other.
    const open = [...card(2).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open thread');
    open.focus();
    expect(document.activeElement).toBe(open);
    threads.list = [{ ...threads.list[1], unread: 1, at: 9000 }, threads.list[0]];
    store.me.threads = { c1_t2: 1 };
    const reads = threads.reads;
    store.emit('workspace');
    await until(d, () => threads.reads > reads);
    await d.tick(20);
    expect([...v.el.querySelectorAll('.thread-card')].map((c) => c.dataset.thread)).toEqual(['c1_t2', 'c1_t1']);
    expect(card(2).classList.contains('unread')).toBe(true);
    const at = document.activeElement;
    expect(card(2).contains(at)).toBe(true);
    expect(at.textContent.trim()).toBe('Open thread');
    v.destroy();
  });
});
