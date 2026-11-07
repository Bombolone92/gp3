/**
 * Conversation UI (review pass 21), driven in node through
 * tests/helpers/dom.js as the pass-19 and pass-20 files are: a fresh DOM and
 * a fresh module registry for every test, Puter faked at
 * `puter.workers.exec`, the toast, the theme, the modal layer and navigation
 * mocked.
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
vi.mock('../src/lib/archive.js', async (importOriginal) => ({ ...(await importOriginal()), exportWorkspace: vi.fn(), transferWorkspace: vi.fn() }));

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
    id: 'abc123def0', name: 'Globex', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 }, c2: { id: 'c2', name: 'random', count: 3 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 },
      u3: { role: 'member', name: 'Ben Ito', username: 'ben', color: 3 },
    },
  };
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
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

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });

/** A conversation view on #general with the given messages, its rows and the menu on the page. */
async function openView(messages) {
  const { dom: d } = await boot();
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
  Object.assign(store.conv('c1'), { loaded: true, seq: messages.length, hasMore: false, messages });
  const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
  document.body.append(view.el);
  await d.tick(3);
  const rows = () => [...view.el.querySelectorAll('.msg')];
  const menu = () => document.querySelector('.menu[role="menu"]');
  const items = () => [...document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent);
  return { d, view, rows, menu, items };
}

/** The list's scroller standing as if the reader had scrolled up into the history: a tall list, a short viewport, the top well above the end. */
function scrolledUp(view, { height = 2000, viewport = 500, top = 300 } = {}) {
  const scroller = view.el.querySelector('.msg-scroll');
  Object.defineProperty(scroller, 'scrollHeight', { get: () => height, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { get: () => viewport, configurable: true });
  scroller.scrollTop = top;
  return scroller;
}

describe('a change to a queued message under a reader who has scrolled up', () => {
  const file = { name: 'pic.png', size: 10, type: 'image/png', uploading: true };
  const queued = (extra) => ({ seq: null, tempId: 't1', cid: 't1', user: 'u-me', text: 'see', ts: 1_700_000_000_000 + 10, kind: 'msg', queued: true, attachments: [file], mentions: [], reactions: {}, replyCount: 0, ...extra });

  it('leaves the reader where they are when one of its files lands (the outbox says "local" with nothing added), as a confirmation does', async () => {
    const { d, view } = await openView([message(1), message(2), message(3), queued()]);
    const scroller = scrolledUp(view);
    // The upload went through: the placeholder's file card turns into the
    // picture, and the store says so as it says everything about the
    // placeholders, "local" with nothing added.
    store.conv('c1').messages[3].attachments = [{ id: 'f1', name: 'pic.png', size: 10, type: 'image/png' }];
    store.emit('messages', { conv: 'c1', reason: 'local' });
    await d.tick(3);
    expect(view.el.querySelectorAll('.msg')).toHaveLength(4);
    expect(view.el.querySelector('.attachment-waiting')).toBeNull();
    expect(scroller.scrollTop).toBe(300);
    view.destroy();
  });

  it('still takes the reader to the bottom with a message of their own posted now', async () => {
    const { d, view } = await openView([message(1), message(2), message(3)]);
    const scroller = scrolledUp(view);
    const temp = { tempId: 't2', cid: 't2', user: 'u-me', text: 'on it', ts: Date.now(), kind: 'msg', pending: true, attachments: [], mentions: [], reactions: {} };
    store.conv('c1').messages.push(temp);
    store.emit('messages', { conv: 'c1', reason: 'local', added: [temp] });
    await d.tick(3);
    expect(scroller.scrollTop).toBe(2000);
    view.destroy();
  });

  it('keeps a reader at the bottom there through such a change', async () => {
    const { d, view } = await openView([message(1), message(2), message(3), queued()]);
    const scroller = scrolledUp(view, { top: 1500 }); // 2000 - 1500 - 500 = 0: at the very bottom
    store.conv('c1').messages[3].attachments = [{ id: 'f1', name: 'pic.png', size: 10, type: 'image/png' }];
    store.emit('messages', { conv: 'c1', reason: 'local' });
    await d.tick(3);
    expect(scroller.scrollTop).toBe(2000);
    view.destroy();
  });
});

describe('"The very beginning" in the jump menu', () => {
  /** A list on #general whose first message is gone (deleted, so no page carries it), the reader at the bottom of the newest page; `read` is the worker's read cursor (0: every message unread, with a New line over the first). */
  async function atBottomOfHistory({ read = 0 } = {}) {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [2, 3, 4, 5].map((n) => message(n)) });
    store.act.c.c1 = { s: 5 };
    store.me.reads.c1 = read;
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const scroller = list.el.querySelector('.msg-scroll');
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 500, configurable: true });
    scroller.scrollTop = 1500;
    const live = list.el.querySelector('[aria-live="polite"]');
    return { d, list, scroller, live };
  }

  it('lands at the top of the window without saying a message is gone when the first message was deleted', async () => {
    const { d, list, scroller, live } = await atBottomOfHistory();
    // The store loads the window around message 1 and says so, as loadAround
    // does: the message itself is in no page.
    const jump = vi.spyOn(store, 'loadAround').mockImplementation(async (convId, seq) => {
      store.emit('messages', { conv: convId, reason: 'init', focus: seq, found: false });
    });
    list.el.querySelector('.date-float').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('The very beginning')).click();
    await d.tick(3);
    expect(jump).toHaveBeenCalledWith('c1', 1);
    expect(scroller.scrollTop).toBe(0);
    expect(live.textContent).toBe('');
    list.destroy();
  });

  it('gives way to a jump asked for before it has loaded: the latest messages then land at their end, not at the top', async () => {
    // Everything read: a fresh page lands at its end, with no New line to land on instead.
    const { d, list, scroller } = await atBottomOfHistory({ read: 5 });
    // The beginning is asked for, and the worker is slow to answer...
    vi.spyOn(store, 'loadAround').mockImplementation(() => new Promise(() => {}));
    list.el.querySelector('.date-float').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('The very beginning')).click();
    await d.tick(2);
    expect(scroller.scrollTop).toBe(1500);
    // ...so the reader asks for the latest messages instead, which land as a fresh page does.
    vi.spyOn(store, 'jumpToLatest').mockImplementation(async (convId) => {
      store.emit('messages', { conv: convId, reason: 'init' });
    });
    list.el.querySelector('.date-float').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Latest messages')).click();
    await d.tick(3);
    expect(scroller.scrollTop).toBe(2000);
    list.destroy();
  });

  it('says a linked message is gone and lands on the one now at its place', async () => {
    const { d, list, live } = await atBottomOfHistory();
    // The rows are drawn anew by the redraw: what is scrolled to is read off
    // the element class, and put back after.
    const proto = Object.getPrototypeOf(list.el.querySelector('.msg'));
    const orig = proto.scrollIntoView;
    const seen = [];
    proto.scrollIntoView = function scrollIntoView() { seen.push(this.dataset?.seq ?? this.className); };
    try {
      // A link to message 3, deleted meanwhile: the window is laid again without it.
      store.conv('c1').messages = [1, 2, 4, 5].map((n) => message(n));
      store.emit('messages', { conv: 'c1', reason: 'init', focus: 3, found: false });
      await d.tick(3);
      expect(live.textContent).toBe('That message is no longer here');
      expect(seen).toEqual(['4']);
    } finally {
      proto.scrollIntoView = orig;
    }
    list.destroy();
  });
});

describe('a file dropped into the box after a chip was removed mid-upload', () => {
  const plan = { name: 'plan.pdf', size: 1234, type: 'application/pdf' };
  const notes = { name: 'notes.txt', size: 99, type: 'text/plain' };

  it('is still on its way for the box opened next, which shows it going up and takes it when it lands', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    // The uploads are held until finished here, in the order they began.
    const pending = [];
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise((r) => pending.push(r)));
    const key = `${REF}:c1`;
    const open = () => {
      const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const chips = (box) => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent}${c.classList.contains('uploading') ? ' (uploading)' : ''}`);
    const drop = (box, file) => {
      const input = box.el.querySelector('input[type="file"]');
      input.files = [file];
      input.dispatchEvent(new Event('change'));
    };
    const a = open();
    d.type(a.textarea, 'hello');
    drop(a, plan);
    await d.tick(1);
    expect(pending).toHaveLength(1);
    // The first file is taken out of the box before it has landed...
    a.el.querySelector('.chip button[aria-label="Remove plan.pdf"]').click();
    expect(chips(a)).toEqual([]);
    // ...and a second one dropped in, which starts going up.
    drop(a, notes);
    await d.tick(1);
    expect(pending).toHaveLength(2);
    expect(chips(a)).toEqual(['notes.txt (uploading)']);
    // The first lands, for nobody (it was removed); the second is still going up.
    pending[0]({ id: 'f1', ...plan });
    await d.tick(2);
    expect(chips(a)).toEqual(['notes.txt (uploading)']);
    // The reader leaves the conversation and comes back before the second has landed.
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual(['notes.txt (uploading)']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(true);
    pending[1]({ id: 'f2', ...notes });
    await d.tick(2);
    expect(chips(b)).toEqual(['notes.txt']);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [{ id: 'f2', ...notes }] });
    b.destroy();
  });
});

describe('the keyboard on a control of a message that is not a button (the card quoting a linked message; a mention chip) when the list is redrawn', () => {
  it('stays on it, found again in the fresh row, rather than falling back to the row', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { absoluteLink } = await import('../src/lib/router.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    // A message in #general linking to one in #random, which the store holds: the card under it is drawn at once.
    Object.assign(store.conv('c2'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3, 'u3', { text: 'the plan' })] });
    const link = absoluteLink({ ws: REF, conv: 'c2', message: 3 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1, 'u3', { text: `see ${link}` }), message(2)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const card = view.el.querySelector('.msg-quote');
    expect(card).toBeTruthy();
    expect(card.getAttribute('role')).toBe('link');
    expect(card.getAttribute('tabindex')).toBe('0');
    card.focus();
    expect(document.activeElement).toBe(card);
    // A poll brings the workspace afresh (someone's presence, a topic): the list is drawn again.
    store.emit('workspace');
    await d.tick(2);
    const fresh = view.el.querySelector('.msg-quote');
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(card);
    expect(document.activeElement).toBe(fresh);
    view.destroy();
  });
});

describe('the accessible name of a message that was not sent', () => {
  const own = (extra) => ({ seq: null, tempId: 't1', cid: 't1', user: 'u-me', text: 'see', ts: 1_700_000_000_000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });

  it('says "not sent", as the row reads, for a queued message set aside and for a send that failed', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const ctx = { convId: 'c1', onShowMember() {}, membersByUsername: store.membersByUsername() };
    const aside = renderMessage(own({ queued: true, failed: true, error: { message: 'Not sent' } }), ctx);
    expect(aside.querySelector('.msg-failed-row').textContent).toContain('Not sent');
    expect(aside.getAttribute('aria-label')).toBe('Me, not sent');
    const failed = renderMessage(own({ pending: false, failed: true, error: { message: 'Could not reach the server' } }), ctx);
    expect(failed.getAttribute('aria-label')).toBe('Me, not sent');
    // Still in line, and still going: as before.
    expect(renderMessage(own({ queued: true }), ctx).getAttribute('aria-label')).toBe('Me, queued');
    expect(renderMessage(own({ pending: true }), ctx).getAttribute('aria-label')).toBe('Me, sending');
  });
});

describe('the list of files under "Bookmark a file in channel"', () => {
  it('names each file as it is shown everywhere else, without the direction marks a name may carry', async () => {
    const { dom: d, api } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000, bookmarks: [] });
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    vi.spyOn(api, 'updateChannel').mockResolvedValue({ channel: {} });
    // A right-to-left override in a name makes "invoice‮fdp.exe" read as "invoiceexe.pdf".
    const tricky = 'invoice‮fdp.exe';
    const files = [{ id: 'f1', name: 'pic.png', size: 10, type: 'image/png' }, { id: 'f2', name: tricky, size: 20, type: 'application/octet-stream' }];
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u3', { attachments: files })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    view.el.querySelector('.msg [aria-label="More actions"]').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Bookmark a file in channel')).click();
    await d.tick(1);
    const labels = [...document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[1]).toBe('invoicefdp.exe');
    expect(labels.some((l) => l.includes('‮'))).toBe(false);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    view.destroy();
  });
});

describe('a long press on a message with a finger while words are selected elsewhere on the page', () => {
  /** A conversation on a touch screen, a stale element outside the list standing for the sidebar, and a way to press a row long. */
  async function touchView() {
    const { dom: d } = await boot({ coarse: true, hover: false });
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), message(2)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    const aside = document.createElement('div');
    aside.className = 'sidebar-stand-in';
    aside.textContent = 'general';
    document.body.append(aside, view.el);
    await d.tick(3);
    const rows = [...view.el.querySelectorAll('.msg')];
    const press = (row) => {
      const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperties(ev, { pointerType: { value: 'touch' }, clientX: { value: 40 }, clientY: { value: 40 } });
      row.dispatchEvent(ev);
    };
    const menu = () => document.querySelector('.menu[role="menu"]');
    return { d, view, rows, aside, press, menu };
  }

  it('opens the menu: a word left selected in the sidebar, or in another message, is not this press selecting words', async () => {
    const { d, view, rows, aside, press, menu } = await touchView();
    const selecting = window.getSelection;
    try {
      // A selection standing in the sidebar since an earlier press.
      window.getSelection = () => ({ toString: () => 'general', anchorNode: aside, focusNode: aside, rangeCount: 0 });
      press(rows[0]);
      await d.tick(700);
      expect(menu()).toBeTruthy();
      d.key(document.activeElement, 'Escape');
      await d.tick(2);
      expect(menu()).toBeNull();
      // One standing in another message.
      window.getSelection = () => ({ toString: () => 'm2', anchorNode: rows[1].querySelector('.msg-text'), focusNode: rows[1].querySelector('.msg-text'), rangeCount: 0 });
      press(rows[0]);
      await d.tick(700);
      expect(menu()).toBeTruthy();
      d.key(document.activeElement, 'Escape');
      await d.tick(2);
    } finally {
      window.getSelection = selecting;
    }
    view.destroy();
  });

  it('opens no menu while the selection lies in the pressed row, whether by its ends or by a range across it', async () => {
    const { d, view, rows, aside, press, menu } = await touchView();
    const selecting = window.getSelection;
    try {
      window.getSelection = () => ({ toString: () => 'm1', anchorNode: rows[0].querySelector('.msg-text'), focusNode: rows[0].querySelector('.msg-text'), rangeCount: 0 });
      press(rows[0]);
      await d.tick(700);
      expect(menu()).toBeNull();
      // Begun in the sidebar and dragged across the row: the range takes the row in.
      window.getSelection = () => ({ toString: () => 'general m1', anchorNode: aside, focusNode: aside, rangeCount: 1, getRangeAt: () => ({ intersectsNode: (n) => n === rows[0] }) });
      press(rows[0]);
      await d.tick(700);
      expect(menu()).toBeNull();
    } finally {
      window.getSelection = selecting;
    }
    view.destroy();
  });
});

describe('the row a menu stands open on, when the list is redrawn under the menu', () => {
  it('keeps holding its hover bar and its light (the menu-open class moves to the fresh row), and lets go when the menu closes', async () => {
    const { d, view, rows, menu } = await openView([message(1), message(2)]);
    const old = rows()[0];
    old.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    expect(menu()).toBeTruthy();
    expect(old.classList.contains('menu-open')).toBe(true);
    // The poll brings the workspace afresh: every row is a new element.
    store.emit('workspace');
    await d.tick(2);
    const fresh = rows()[0];
    expect(fresh).not.toBe(old);
    expect(fresh.dataset.seq).toBe('1');
    expect(menu()).toBeTruthy();
    expect(fresh.classList.contains('menu-open')).toBe(true);
    expect(rows()[1].classList.contains('menu-open')).toBe(false);
    // The menu closes: the fresh row lets go of the class too.
    d.key(document.activeElement, 'Escape');
    await d.tick(2);
    expect(menu()).toBeNull();
    expect(view.el.querySelector('.msg.menu-open')).toBeNull();
    view.destroy();
  });
});

describe('which waiting file says "Uploading…"', () => {
  const file = (extra) => ({ name: 'pic.png', size: 10, type: 'image/png', uploading: true, ...extra });
  const queued = (files, extra) => ({ seq: null, tempId: 't1', cid: 't1', user: 'u-me', text: 'see', ts: 1_700_000_000_000, kind: 'msg', queued: true, attachments: files, mentions: [], reactions: {}, replyCount: 0, ...extra });
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));

  it('is the file the outbox is on alone: the ones behind it, and a message the outbox has not reached, wait', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const ctx = { convId: 'c1', onShowMember() {}, membersByUsername: store.membersByUsername() };
    const words = (row) => [...row.querySelectorAll('.attachment-waiting')].map((c) => (c.textContent.includes('Uploading') ? 'up' : 'wait'));
    expect(words(renderMessage(queued([file({ up: true, name: 'a.png' }), file({ name: 'b.png' })]), ctx))).toEqual(['up', 'wait']);
    expect(words(renderMessage(queued([file()]), ctx))).toEqual(['wait']);
    // Set aside: nothing goes up, whatever the mark says.
    expect(words(renderMessage(queued([file({ up: true })], { failed: true, error: { message: 'Not sent' } }), ctx))).toEqual(['wait']);
  });

  it('is marked by the outbox on the entry whose file is going up, on that one alone, for as long as it goes up', async () => {
    const { createOutbox, memoryStorage } = await import('../src/lib/outbox.js');
    let finish = null;
    const box = createOutbox({ storage: memoryStorage(), sendEntry: async () => {}, uploadFile: () => new Promise((r) => { finish = r; }) });
    await box.enqueue({ id: 'e1', ws: 'w', conv: 'c', text: 'first', ts: 1, files: [{ name: 'a.png', type: 'image/png', blob: {} }] });
    await box.enqueue({ id: 'e2', ws: 'w', conv: 'c', text: 'second', ts: 2, files: [{ name: 'b.png', type: 'image/png', blob: {} }] });
    expect((await box.list()).map((e) => !!e.up)).toEqual([false, false]);
    const flushing = box.flush();
    await tick(5);
    expect((await box.list()).map((e) => [e.id, !!e.up])).toEqual([['e1', true], ['e2', false]]);
    finish({ id: 'f1', name: 'a.png', size: 10, type: 'image/png' });
    await tick(5);
    // The first has gone out; the second's file is the one going up now.
    expect((await box.list()).map((e) => [e.id, !!e.up])).toEqual([['e2', true]]);
    finish({ id: 'f2', name: 'b.png', size: 10, type: 'image/png' });
    await flushing;
    expect(await box.list()).toEqual([]);
  });

  it('reaches the placeholder drawn from the entry (after a reload, and as the mark moves), the store copying it onto the first waiting file', async () => {
    await boot();
    const blob = { size: 10, type: 'image/png' };
    const entry = (extra) => ({ id: 't9', ws: REF, conv: 'c1', text: 'see', ts: 1_700_000_000_000, ...extra });
    const listed = vi.spyOn(store.outbox, 'list').mockResolvedValue([entry({ files: [{ name: 'a.png', type: 'image/png', blob }, { name: 'b.png', type: 'image/png', blob }], up: true })]);
    await store._restoreQueued();
    const m = store.conv('c1').messages.find((x) => x.tempId === 't9');
    expect(m.attachments.map((a) => [a.name, !!a.uploading, !!a.up])).toEqual([['a.png', true, true], ['b.png', true, false]]);
    // The first file landed and the outbox is between files: the placeholder follows (see _syncQueued).
    listed.mockResolvedValue([entry({ attachments: [{ id: 'f1', name: 'a.png', size: 10, type: 'image/png' }], files: [{ name: 'b.png', type: 'image/png', blob }] })]);
    await store._syncQueued();
    expect(m.attachments.map((a) => [a.name, !!a.uploading, !!a.up])).toEqual([['a.png', false, false], ['b.png', true, false]]);
  });
});

describe('the label of a file bookmarked from its message', () => {
  it('is cut between whole characters within the worker’s count: a flag at the edge is left out rather than halved into a boxed letter', async () => {
    const { dom: d, api } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000, bookmarks: [] });
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    const update = vi.spyOn(api, 'updateChannel').mockResolvedValue({ channel: {} });
    // Thirty-eight letters, then a flag (two regional indicators, four UTF-16
    // units): the cap of forty falls in the middle of the flag.
    const name = `${'a'.repeat(38)}🇬🇧.png`;
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u3', { attachments: [{ id: 'f1', name, size: 20, type: 'application/pdf' }] })] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    view.el.querySelector('.msg [aria-label="More actions"]').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Bookmark file in channel')).click();
    await d.tick(3);
    expect(update).toHaveBeenCalledTimes(1);
    const label = update.mock.calls[0][2].bookmarks[0].label;
    expect(label).toBe('a'.repeat(38));
    expect(label.length).toBeLessThanOrEqual(40);
    view.destroy();
  });
});

describe('a link typed with a scheme of its own', () => {
  it('is refused by the bookmarks form rather than saved as an https link to the wrong place; a bare address still means https', async () => {
    const { dom: d, api } = await boot();
    const { bookmarksDialog } = await import('../src/ui/bookmarks.js');
    store.ws.channels.c1.bookmarks = [];
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    const update = vi.spyOn(api, 'updateChannel').mockResolvedValue({ channel: {} });
    bookmarksDialog(store.ws.channels.c1);
    const form = document.querySelector('.bm-form');
    const [labelInput, urlInput] = form.querySelectorAll('input');
    const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const error = () => form.querySelector('.field-error');
    for (const typed of ['mailto:ana@example.com', 'javascript:alert(1)', 'ftp://files.example.com/x']) {
      d.type(labelInput, 'Mail');
      d.type(urlInput, typed);
      submit();
      await d.tick(2);
      expect(update).not.toHaveBeenCalled();
      expect(error().hidden).toBe(false);
      expect(error().textContent).toContain('starting with https://');
      expect(urlInput.getAttribute('aria-invalid')).toBe('true');
    }
    d.type(urlInput, 'example.com/docs');
    submit();
    await d.tick(3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][2].bookmarks).toEqual([{ label: 'Mail', url: 'https://example.com/docs' }]);
  });

  it('goes into a message as typed from the box’s link popover, not dressed as https', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
    document.body.append(box.el);
    // The test DOM's box has no setRangeText: the browser's, in short.
    box.textarea.setRangeText = function setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); };
    const add = async (typed) => {
      box.el.querySelector('[aria-label="Link"]').click();
      const input = document.querySelector('.link-pop input');
      dom.type(input, typed);
      input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await dom.tick(1);
    };
    box.textarea.value = '';
    box.textarea.setSelectionRange(0, 0);
    await add('mailto:ana@example.com');
    expect(box.textarea.value).toBe('mailto:ana@example.com');
    box.textarea.value = '';
    box.textarea.setSelectionRange(0, 0);
    await add('example.com');
    expect(box.textarea.value).toBe('https://example.com');
    box.destroy();
  });
});

describe('a message menu open on a Threads view card while the card is drawn again', () => {
  it('keeps the row lit under the menu (the class moves to the fresh row) and lets go when the menu closes', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    // The worker, for the Threads view: one thread, its replies already read.
    const root = { seq: 1, user: 'u2', ts: 1_700_000_000_001, text: 'root 1', kind: 'msg', replyCount: 2, attachments: [], mentions: [], reactions: {} };
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    expect(card).toBeTruthy();
    const old = card.querySelector('.msg.thread-root');
    expect(old).toBeTruthy();
    old.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    const menu = () => document.querySelector('.menu[role="menu"]');
    expect(menu()).toBeTruthy();
    expect(old.classList.contains('menu-open')).toBe(true);
    // A reply lands in the thread: the card draws its rows anew under the open menu.
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    const fresh = card.querySelector('.msg.thread-root');
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(old);
    expect(menu()).toBeTruthy();
    expect(fresh.classList.contains('menu-open')).toBe(true);
    // The menu closes: the fresh row lets go of the class too.
    d.key(document.activeElement, 'Escape');
    await d.tick(2);
    expect(menu()).toBeNull();
    expect(card.querySelector('.msg.menu-open')).toBeNull();
    v.destroy();
  });
});

describe('the waiting card under a queued message', () => {
  const name = 'quarterly-report-final-version-2026-09-07.pdf';
  const queued = (extra) => ({ seq: null, tempId: 't1', user: 'u-me', text: 'see', ts: 1_700_000_000_000, kind: 'msg', queued: true, attachments: [{ name, size: 2048, type: 'application/pdf', uploading: true }], mentions: [], reactions: {}, replyCount: 0, ...extra });

  it('cuts a long file name in the middle with the end kept, as the file cards do, with the whole name in its tooltip', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const { fileLabelShort } = await import('../src/ui/filename.js');
    const ctx = { convId: 'c1', onShowMember() {}, membersByUsername: store.membersByUsername() };
    const row = renderMessage(queued(), ctx);
    const card = row.querySelector('.attachment-waiting');
    const shown = card.querySelector('strong').textContent;
    expect(shown).toBe(fileLabelShort(name));
    expect(shown).toContain('…');
    expect(shown.endsWith('26-09-07.pdf')).toBe(true); // the last twelve characters: the date and the extension
    expect(card.getAttribute('title')).toBe(name);
  });
});
