/**
 * Conversation UI (review pass 13), driven in node through
 * tests/helpers/dom.js: a small DOM with a tree, attributes, focus,
 * bubbling events and a selector engine, and matchMedia by viewport. Every
 * test boots a fresh DOM and a fresh module registry, so the listeners the
 * modules hang on window and document never outlive their test. Puter is
 * faked at `puter.workers.exec`; the toast, the theme, the modal layer and
 * navigation are mocked, since they paint the page at import.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({
  confirmDialog: vi.fn(async () => true),
  closeAllModals: vi.fn(),
  // The dialog's content goes onto the page as it would inside a panel; close takes it off and tells the opener.
  openModal: vi.fn(({ content, onClose }) => {
    document.body.append(content);
    const close = vi.fn(() => { content.remove(); onClose?.(); });
    return { close, panel: content, root: content };
  }),
}));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));

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
  return { store, api, dom };
}

afterEach(() => {
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

const message = (seq, user = 'u2') => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

/** Give the fake scroller a size, so the reader can stand away from the bottom. */
function sizeScroller(scroller, { height = 1000, viewport = 500 } = {}) {
  Object.defineProperty(scroller, 'scrollHeight', { value: height, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: viewport, configurable: true });
}

describe('the message list and the read cursor', () => {
  it('does not take a workspace document from before a read landed for a mark-unread', async () => {
    const { api, dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 6, hasMore: false, messages: [1, 2, 3, 4, 5, 6].map(message) });
    store.me.reads.c1 = 5;
    store.act.c.c1 = { s: 6 };
    vi.spyOn(api, 'markRead').mockResolvedValue({});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5); // lands at the bottom: m6 is read here, and the read goes out
    expect(store.unreadCount('c1')).toBe(0);
    // The read lands at the worker and a poll passes: the cursor stands at m6.
    store.me.reads.c1 = 6;
    store.emit('activity');
    // A workspace document asked for before that read landed arrives now (a
    // topic changed elsewhere brought it): the cursor it carries is the old
    // one. The store lays the document over its own and counts unread
    // against what was read here, so nothing is unread.
    vi.spyOn(api, 'workspace').mockResolvedValue({
      workspace: { ...store.ws }, me: { ...store.me, reads: { c1: 5 } },
      activity: { w: 1, u: {}, c: { c1: { s: 6 } } }, now: Date.now(),
    });
    await store.refreshWorkspace();
    // The store holds the cursor where the read left it (a document from
    // before the read carries the cursor from before; see refreshWorkspace),
    // and nothing is unread.
    expect(store.me.reads.c1).toBe(6);
    expect(store.unreadCount('c1')).toBe(0);
    // m7 arrives while the reader has scrolled up a screen: the pill, not a read.
    sizeScroller(list.scroller);
    list.scroller.scrollTop = 0;
    store.conv('c1').messages.push(message(7));
    store.conv('c1').seq = 7;
    store.act.c.c1 = { s: 7 };
    store.emit('activity');
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [message(7)] });
    await d.tick(5);
    expect(list.el.querySelector('.jump-pill')).toBeTruthy();
    // The reader scrolls down to it: that is reading it.
    const markRead = vi.spyOn(store, 'markRead');
    list.scroller.scrollTop = 500;
    list.scroller.dispatchEvent(new Event('scroll'));
    expect(markRead).toHaveBeenCalledWith('c1', 7);
    list.destroy();
  });

  it('still keeps a conversation marked unread from here while the reader stays at the bottom', async () => {
    const { api, dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [1, 2, 3, 4, 5].map(message) });
    store.me.reads.c1 = 5;
    store.act.c.c1 = { s: 5 };
    vi.spyOn(api, 'markRead').mockResolvedValue({});
    vi.spyOn(api, 'markUnread').mockResolvedValue({});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const markRead = vi.spyOn(store, 'markRead');
    await store.markUnread('c1', 3);
    expect(store.me.reads.c1).toBe(2);
    expect(store.unreadCount('c1')).toBe(3);
    // Still at the bottom: a scroll, a redraw, the tab shown again are not a read.
    list.scroller.dispatchEvent(new Event('scroll'));
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(markRead).not.toHaveBeenCalled();
    // A message arriving under the reader at the bottom is read as it lands.
    store.conv('c1').messages.push(message(6));
    store.conv('c1').seq = 6;
    store.act.c.c1 = { s: 6 };
    store.emit('activity');
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [message(6)] });
    await d.tick(5);
    expect(markRead).toHaveBeenCalledWith('c1', 6);
    list.destroy();
  });

});

describe('editing a message in place', () => {
  it('saves once when Enter is pressed twice before the worker has answered', async () => {
    await boot();
    const { renderMessage, startInlineEdit } = await import('../src/ui/message.js');
    const msg = message(7, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    expect(startInlineEdit(row)).toBe(true);
    let settle = null;
    const edit = vi.spyOn(store, 'edit').mockImplementation(() => new Promise((r) => { settle = r; }));
    const input = row.querySelector('.msg-edit-input');
    input.value = 'm7, corrected';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    row.querySelector('.msg-edit-actions .btn-primary').click();
    expect(edit).toHaveBeenCalledTimes(1);
    settle();
    await new Promise((r) => setTimeout(r, 2));
    expect(row.classList.contains('editing')).toBe(false);
  });

  it('takes a second Save after the first was refused', async () => {
    await boot();
    const { renderMessage, startInlineEdit } = await import('../src/ui/message.js');
    const msg = message(7, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    startInlineEdit(row);
    const edit = vi.spyOn(store, 'edit').mockRejectedValueOnce(new Error('You are offline')).mockResolvedValueOnce(undefined);
    const input = row.querySelector('.msg-edit-input');
    input.value = 'm7, corrected';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 2));
    expect(row.classList.contains('editing')).toBe(true); // the box stays, with the words, to try again
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 2));
    expect(edit).toHaveBeenCalledTimes(2);
    expect(row.classList.contains('editing')).toBe(false);
  });
});

describe('the bookmarks dialog', () => {
  const channelWith = (bookmarks) => {
    store.ws.channels.c1.bookmarks = bookmarks.map((b) => ({ ...b }));
    return store.ws.channels.c1;
  };
  const labels = () => [...document.querySelectorAll('.bm-row strong')].map((n) => n.textContent);

  it('shows the list as the worker has it after two moves that both failed', async () => {
    const { api } = await boot();
    const { bookmarksDialog } = await import('../src/ui/bookmarks.js');
    const ch = channelWith([{ label: 'Docs', url: 'https://docs.example' }, { label: 'Board', url: 'https://board.example' }, { label: 'Wiki', url: 'https://wiki.example' }]);
    // Offline: every save is refused, once the request has had its moment.
    vi.spyOn(api, 'updateChannel').mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('You are offline')), 5)));
    bookmarksDialog(ch);
    expect(labels()).toEqual(['Docs', 'Board', 'Wiki']);
    // Docs down twice, quickly: the list shows each move at once.
    document.querySelector('[aria-label="Move Docs down"]').click();
    expect(labels()).toEqual(['Board', 'Docs', 'Wiki']);
    document.querySelector('[aria-label="Move Docs down"]').click();
    expect(labels()).toEqual(['Board', 'Wiki', 'Docs']);
    await new Promise((r) => setTimeout(r, 20));
    // Neither move was taken: the list stands as it was, not one move along.
    expect(labels()).toEqual(['Docs', 'Board', 'Wiki']);
  });
});

describe('a list left within its first frame', () => {
  it('does not mark the conversation read when the reader moved on before it landed', async () => {
    const { api, dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [1, 2, 3, 4, 5].map(message) });
    store.me.reads.c1 = 2;
    store.act.c.c1 = { s: 5 };
    vi.spyOn(api, 'markRead').mockResolvedValue({});
    const markRead = vi.spyOn(store, 'markRead');
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    // Gone again before the frame in which the list lands (a second
    // navigation in the same moment): m3 to m5 were never on screen.
    list.destroy();
    await d.tick(5);
    expect(markRead).not.toHaveBeenCalled();
    expect(store.unreadCount('c1')).toBe(3);
  });

  it('does not mark it read for a message that landed as the reader left', async () => {
    const { api, dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [1, 2, 3, 4, 5].map(message) });
    store.me.reads.c1 = 5;
    store.act.c.c1 = { s: 5 };
    vi.spyOn(api, 'markRead').mockResolvedValue({});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const markRead = vi.spyOn(store, 'markRead');
    // m6 arrives under a reader at the bottom, who leaves in the same frame.
    store.conv('c1').messages.push(message(6));
    store.conv('c1').seq = 6;
    store.act.c.c1 = { s: 6 };
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [message(6)] });
    list.destroy();
    await d.tick(5);
    expect(markRead).not.toHaveBeenCalled();
  });
});

describe('the details dialog', () => {
  it('keeps the keyboard inside the dialog after Join channel is pressed from it', async () => {
    const { dom: d } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    // A public channel the member is not in yet.
    store.ws.channels.c3 = { id: 'c3', name: 'zeta', count: 2, createdBy: 'u2', createdAt: 1_700_000_000_000 };
    store.act.c.c3 = { s: 0 };
    vi.spyOn(store, 'joinChannel').mockImplementation(async () => {
      store.me.channels.push('c3');
      store.emit('workspace');
    });
    vi.spyOn(store, 'loadPins').mockResolvedValue([]);
    openDetailsDialog('c3');
    const joinRow = [...document.querySelectorAll('.details-row')].find((r) => r.textContent.includes('Join channel'));
    expect(joinRow).toBeTruthy();
    joinRow.focus();
    expect(document.activeElement).toBe(joinRow);
    joinRow.click();
    await d.tick(5);
    expect(store.isJoined('c3')).toBe(true);
    // The row is gone with the join; the keyboard is on a control of the dialog, not on the page body.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector('.details-dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('the composer', () => {
  const rows = (composer) => [...composer.el.querySelectorAll('.mention-pop .pick-item strong')].map((n) => n.textContent);
  const typed = (textarea, text) => {
    textarea.value = text;
    textarea.selectionStart = text.length;
    textarea.selectionEnd = text.length;
    textarea.dispatchEvent(new Event('input'));
  };

  it('offers the mention list after a bracket or a quote, wherever the worker would read a mention', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const { textarea } = composer;
    typed(textarea, 'thanks (@an');
    expect(rows(composer)).toEqual(['Ana Rocha']);
    typed(textarea, 'see "@be');
    expect(rows(composer)).toEqual(['Ben Ito']);
    typed(textarea, 'cc:@an');
    expect(rows(composer)).toEqual(['Ana Rocha']);
    // An address is not a mention, here as on the worker.
    typed(textarea, 'mail nj@pu');
    expect(rows(composer)).toEqual([]);
    typed(textarea, 'plain @an');
    expect(rows(composer)).toEqual(['Ana Rocha']);
    composer.destroy();
  });
});

describe('right-to-left text beyond the message itself', () => {
  const hebrew = 'שלום לכולם!';

  it('lets a pinned preview, a forwarded preview, the topic and the description take their own direction', async () => {
    await boot();
    const { renderPinList } = await import('../src/ui/pins.js');
    const { forwardMessageDialog } = await import('../src/ui/dialogs.js');
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { openDetailsDialog } = await import('../src/ui/details.js');
    vi.spyOn(store, 'loadPins').mockResolvedValue([]);
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    const msg = message(3);
    msg.text = hebrew;
    // A pinned message's line.
    const pins = renderPinList('c1', [{ seq: 3, by: 'u2', ts: msg.ts, message: msg }]);
    expect(pins.querySelector('.pin-body').getAttribute('dir')).toBe('auto');
    // The forward dialog's preview of it.
    forwardMessageDialog(msg, { permalink: 'https://app.test/#/ws/x/c/c1/m/3', author: store.member('u2'), conv: 'c1' });
    expect(document.querySelector('.forward-preview-text').getAttribute('dir')).toBe('auto');
    // The channel's topic in the header and its description at the very beginning.
    Object.assign(store.ws.channels.c1, { topic: hebrew, description: hebrew, createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    expect(view.el.querySelector('.conv-topic').getAttribute('dir')).toBe('auto');
    expect(view.el.querySelector('.conv-intro p').getAttribute('dir')).toBe('auto');
    view.destroy();
    // And the details rows that repeat them.
    openDetailsDialog('c1');
    const subs = [...document.querySelectorAll('.details-row .details-text span')];
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((s) => s.getAttribute('dir') === 'auto')).toBe(true);
  });
});

describe('the thread panel while the channel changes under it', () => {
  const openThread = async () => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    const root = message(5);
    root.replyCount = 0;
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [root] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    store.act.c.c1 = { s: 5 };
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(5);
    return { d, panel, thread, root };
  };

  it('gives the reply box up for the column\'s note when the channel is archived, and brings it back with its words when unarchived', async () => {
    const { d, panel, thread } = await openThread();
    const textarea = panel.querySelector('textarea');
    expect(textarea).toBeTruthy();
    textarea.focus();
    textarea.value = 'half a reply';
    textarea.dispatchEvent(new Event('input'));
    // An admin archives the channel elsewhere.
    store.ws.channels.c1.archived = true;
    store.emit('workspace');
    expect(panel.querySelector('textarea')).toBeNull();
    const note = panel.querySelector('.composer-blocked');
    expect(note.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(panel.querySelector('.panel-head [aria-label="Close panel"]'));
    await d.tick(2);
    expect(note.textContent).toBe('This channel is archived. Nobody can post here.');
    expect(panel.querySelector('.typing-line')).toBeTruthy();
    // Unarchived: the box is back, the words still in it, and the keyboard is left where it was.
    store.ws.channels.c1.archived = false;
    store.emit('workspace');
    const again = panel.querySelector('textarea');
    expect(again).toBeTruthy();
    expect(again.value).toBe('half a reply');
    expect(panel.querySelector('.also-send')).toBeTruthy();
    await d.tick(2);
    expect(document.activeElement).not.toBe(again);
    // Replies turned off: the thread's own note.
    store.ws.channels.c1.threadPolicy = 'off';
    store.emit('workspace');
    expect(panel.querySelector('textarea')).toBeNull();
    await d.tick(2);
    expect(panel.querySelector('.composer-blocked').textContent).toBe('Replies are turned off in #general');
    // A change that is not about the box leaves it alone.
    store.ws.channels.c1.threadPolicy = 'everyone';
    store.emit('workspace');
    const box = panel.querySelector('textarea');
    store.ws.channels.c1.topic = 'new topic';
    store.emit('workspace');
    expect(panel.querySelector('textarea')).toBe(box);
    thread.destroy();
  });

  it('closes the thread over a note as it does over a box when the root is deleted', async () => {
    const { d, panel, thread, root } = await openThread();
    store.ws.channels.c1.threadPolicy = 'admins';
    store.emit('workspace');
    expect(panel.querySelector('textarea')).toBeNull();
    root.deleted = true;
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    expect(panel.querySelector('.composer-blocked').textContent).toBe('This thread is closed: its message was deleted');
    expect(panel.querySelector('.typing-line')).toBeNull();
    thread.destroy();
  });
});

describe('toolbars', () => {
  const key = (target, k, init = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  };
  const stops = (bar) => [...bar.querySelectorAll('button')].filter((b) => b.getAttribute('tabindex') === '0');

  it('gives the composer\'s formatting row one tab stop and moves through it with the arrows, Home and End', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const bar = composer.el.querySelector('.composer-fmt');
    const buttons = [...bar.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(3);
    expect(stops(bar)).toEqual([buttons[0]]);
    buttons[0].focus();
    expect(key(buttons[0], 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    expect(stops(bar)).toEqual([buttons[1]]);
    key(buttons[1], 'End');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    key(document.activeElement, 'ArrowRight'); // round at the end
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(buttons[0]);
    // A modified arrow is a shortcut's; one during an IME composition is the IME's.
    expect(key(buttons[0], 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], 'ArrowRight', { isComposing: true });
    expect(document.activeElement).toBe(buttons[0]);
    // Every button still does its work when clicked, tab stop or not: the
    // link button, which is not the stop, opens its address box.
    const link = bar.querySelector('[aria-label="Link"]');
    expect(link.getAttribute('tabindex')).toBe('-1');
    link.click();
    expect(document.querySelector('.menu .link-pop')).toBeTruthy();
    await d.tick(2);
    composer.destroy();
  });

  it('gives a message\'s action bar one tab stop, with every action still a click away', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const msg = message(7);
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    const bar = row.querySelector('.msg-actions');
    const buttons = [...bar.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(3);
    expect(stops(bar)).toHaveLength(1);
    buttons[0].focus();
    key(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    expect(stops(bar)).toEqual([buttons[1]]);
    const save = vi.spyOn(store, 'save').mockResolvedValue(undefined);
    bar.querySelector('[aria-label="Save for later"]').click();
    expect(save).toHaveBeenCalledWith('c1', 7);
  });
});

describe('tab strips', () => {
  const key = (target, k, init = {}) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  };

  it('take Home and End on the conversation\'s Messages and Files tabs', async () => {
    await boot();
    const { navigate } = await import('../src/lib/router.js');
    const { createConversationView } = await import('../src/ui/conversation.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    const tabs = view.el.querySelector('.conv-tabs');
    const selected = () => tabs.querySelector('[aria-selected="true"]');
    selected().focus();
    expect(key(selected(), 'End').defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith({ ws: REF, conv: 'c1', files: true });
    navigate.mockClear();
    key(selected(), 'Home'); // already on Messages: nothing to go to
    expect(navigate).not.toHaveBeenCalled();
    key(selected(), 'ArrowRight');
    expect(navigate).toHaveBeenLastCalledWith({ ws: REF, conv: 'c1', files: true });
    navigate.mockClear();
    expect(key(selected(), 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false); // a shortcut's
    expect(navigate).not.toHaveBeenCalled();
    view.destroy();
  });

  it('take Home and End on the details dialog\'s tabs', async () => {
    await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.channels.c1.createdBy = 'u-me';
    store.ws.channels.c1.createdAt = 1_700_000_000_000;
    vi.spyOn(store, 'loadPins').mockResolvedValue([]);
    openDetailsDialog('c1');
    const strip = document.querySelector('.details-tabs');
    const selected = () => strip.querySelector('[aria-selected="true"]');
    expect(selected().textContent).toBe('About');
    selected().focus();
    key(selected(), 'End');
    expect(selected().textContent).toBe('Settings');
    expect(document.activeElement).toBe(selected());
    key(selected(), 'Home');
    expect(selected().textContent).toBe('About');
    key(selected(), 'ArrowLeft'); // round to the last
    expect(selected().textContent).toBe('Settings');
    key(selected(), 'ArrowRight', { metaKey: true });
    expect(selected().textContent).toBe('Settings');
  });
});

describe('an edit open on a message that is deleted meanwhile', () => {
  const openEdit = async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    const { toast } = await import('../src/ui/toast.js');
    const mine = message(2, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), mine, message(3)] });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    expect(list.editMessage(mine)).toBe(true);
    const input = list.el.querySelector('.msg-edit-input');
    input.focus();
    input.value = 'm2, with a correction';
    input.dispatchEvent(new Event('input'));
    toast.mockClear();
    return { d, list, mine, toast };
  };

  it('says so and lands the keyboard on the tombstone when the message keeps its replies', async () => {
    const { list, mine, toast } = await openEdit();
    mine.deleted = true; // an admin deleted it elsewhere; its thread keeps a tombstone
    store.emit('messages', { conv: 'c1', reason: 'range' });
    expect(list.el.querySelector('.msg-edit-input')).toBeNull();
    expect(toast).toHaveBeenCalledWith('That message was deleted while you were editing it', { icon: 'alert' });
    const tomb = list.el.querySelector('.msg.deleted');
    expect(tomb).toBeTruthy();
    expect(document.activeElement).toBe(tomb);
    list.destroy();
  });

  it('says so and lands the keyboard on the message now at its place when the row went', async () => {
    const { list, mine, toast } = await openEdit();
    store.conv('c1').messages = store.conv('c1').messages.filter((m) => m !== mine);
    store.emit('messages', { conv: 'c1', reason: 'range' });
    expect(list.el.querySelector('.msg-edit-input')).toBeNull();
    expect(toast).toHaveBeenCalledWith('That message was deleted while you were editing it', { icon: 'alert' });
    // The row that was second is gone; the keyboard is on the row now second, m3.
    expect(document.activeElement).toBe(list.el.querySelectorAll('.msg')[1]);
    expect(document.activeElement.dataset.seq).toBe('3');
    list.destroy();
  });
});

describe('the emoji picker\'s search', () => {
  it('finds an emoji typed or pasted as itself, skin tone and all', async () => {
    const { dom: d } = await boot();
    const { openEmojiPicker } = await import('../src/ui/emojipicker.js');
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const pop = openEmojiPicker(anchor, { onPick: vi.fn() });
    const search = document.querySelector('.emoji-search');
    const titles = () => [...document.querySelectorAll('.emoji-cell')].map((c) => c.getAttribute('title'));
    d.type(search, '👋🏽');
    expect(titles()).toEqual([':wave:']);
    expect(document.querySelector('.emoji-picker [role="status"]').textContent).toBe('1 emoji');
    d.type(search, '👍');
    expect(titles()).toEqual([':+1:']);
    d.type(search, '✈️');
    expect(titles()).toEqual([':airplane:']);
    // Letters still search the shortcodes, and a stray word still finds nothing.
    d.type(search, 'wav');
    expect(titles()).toContain(':wave:');
    d.type(search, 'zzzzq');
    expect(titles()).toEqual([]);
    expect(document.querySelector('.emoji-empty').textContent).toContain('zzzzq');
    await d.tick(2);
    pop.close();
  });
});

describe('the day dividers overnight', () => {
  it('say "Yesterday" over what was "Today" once midnight has passed, without redrawing the rows', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    const { dayLabel } = await import('../src/lib/time.js');
    const at = (y, mo, day, h, mi) => new Date(y, mo, day, h, mi).getTime();
    const m1 = { ...message(1), ts: at(2026, 5, 9, 10, 0) };
    const m2 = { ...message(2), ts: at(2026, 5, 10, 11, 59) };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [m1, m2] });
    store.act.c.c1 = { s: 2 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // A minute to midnight on the 10th of June.
    const now = vi.spyOn(Date, 'now').mockReturnValue(at(2026, 5, 10, 23, 59));
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const labels = () => [...list.el.querySelectorAll('.day-divider')].map((n) => [n.getAttribute('aria-label'), n.textContent]);
    expect(labels()).toEqual([['Yesterday', 'Yesterday'], ['Today', 'Today']]);
    const rows = [...list.el.querySelectorAll('.msg')];
    // Midnight passes with the tab in the background; the tab is shown again in the morning.
    now.mockReturnValue(at(2026, 5, 11, 8, 30));
    document.dispatchEvent(new Event('visibilitychange'));
    const june9 = dayLabel(m1.ts, at(2026, 5, 11, 8, 30));
    expect(labels()).toEqual([[june9, june9], ['Yesterday', 'Yesterday']]);
    expect([...list.el.querySelectorAll('.msg')]).toEqual(rows); // the rows stand
    // Another day, and the window takes focus.
    now.mockReturnValue(at(2026, 5, 12, 9, 0));
    window.dispatchEvent(new Event('focus'));
    const later9 = dayLabel(m1.ts, at(2026, 5, 12, 9, 0));
    const later10 = dayLabel(m2.ts, at(2026, 5, 12, 9, 0));
    expect(labels()).toEqual([[later9, later9], [later10, later10]]);
    list.destroy();
  });
});

describe('deleting a private channel nobody is left in', () => {
  const withOrphan = async () => {
    const { dom: d } = await boot();
    const { confirmDialog } = await import('../src/ui/modal.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.channels.c4 = { id: 'c4', name: 'secret', private: true, orphan: true, count: 0, createdBy: 'u2', createdAt: 1_700_000_000_000 };
    return { d, confirmDialog };
  };

  it('leaves the keyboard on the Delete button of the channel page when the question is answered No', async () => {
    const { d, confirmDialog } = await withOrphan();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const view = createConversationView('c4', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    const del = [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Delete channel');
    expect(del).toBeTruthy();
    confirmDialog.mockResolvedValueOnce(false);
    del.focus();
    del.click();
    await d.tick(2);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(del);
    expect(del.disabled).toBe(false);
    view.destroy();
  });

  it('leaves the keyboard on the Delete button of Browse channels when the question is answered No', async () => {
    const { d, confirmDialog } = await withOrphan();
    const { browseChannelsDialog } = await import('../src/ui/dialogs.js');
    browseChannelsDialog();
    const del = document.querySelector('[aria-label="Delete #secret"]');
    expect(del).toBeTruthy();
    confirmDialog.mockResolvedValueOnce(false);
    del.focus();
    del.click();
    await d.tick(2);
    const again = document.querySelector('[aria-label="Delete #secret"]');
    expect(again).toBeTruthy();
    expect(document.activeElement).toBe(again);
  });
});

describe('the jump menu', () => {
  const pressJump = async (label, nowDate) => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [1, 2].map(message) });
    store.act.c.c1 = { s: 2 };
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    vi.spyOn(Date, 'now').mockReturnValue(nowDate.getTime());
    const jump = vi.spyOn(store, 'jumpToDate').mockResolvedValue(undefined);
    list.el.querySelector('.date-float').click();
    const item = [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes(label));
    expect(item).toBeTruthy();
    item.click();
    // The popover hangs its document listeners on the next tick: let it, while the page is still here.
    await d.tick(2);
    list.destroy();
    return jump;
  };
  const openLastMonth = (nowDate) => pressJump('Last month', nowDate);

  it('jumps to the last day of the month before from the 31st, not to a day of this month', async () => {
    const { startOfDay } = await import('../src/lib/time.js');
    // The 31st of March: February has no 31st, so its last day, not the 3rd of March.
    const jump = await openLastMonth(new Date(2026, 2, 31, 10, 30));
    expect(jump).toHaveBeenCalledWith('c1', startOfDay(new Date(2026, 1, 28).getTime()));
  });

  it('jumps to the same day of the month before when it has one', async () => {
    const { startOfDay } = await import('../src/lib/time.js');
    const jump = await openLastMonth(new Date(2026, 0, 15, 10, 30));
    expect(jump).toHaveBeenCalledWith('c1', startOfDay(new Date(2025, 11, 15).getTime()));
  });

  it('jumps to yesterday and to last week by the calendar across a change of the clocks', async () => {
    // Pinned to a zone with the change, so the day before the Monday after
    // it is 23 hours long wherever the test runs. Node re-reads TZ when it is set.
    const zone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const { startOfDay } = await import('../src/lib/time.js');
      // Monday 9 March 2026: the clocks went forward on Sunday the 8th.
      const monday = new Date(2026, 2, 9, 10, 30);
      expect(monday.getTimezoneOffset()).toBe(240); // EDT, or the zone did not take
      const yesterday = await pressJump('Yesterday', monday);
      expect(yesterday).toHaveBeenCalledWith('c1', startOfDay(new Date(2026, 2, 8).getTime()));
      const lastWeek = await pressJump('Last week', monday);
      expect(lastWeek).toHaveBeenCalledWith('c1', startOfDay(new Date(2026, 2, 2).getTime()));
      // Monday 2 November 2026: the clocks went back on Sunday the 1st, a 25-hour day.
      const fall = await pressJump('Yesterday', new Date(2026, 10, 2, 10, 30));
      expect(fall).toHaveBeenCalledWith('c1', startOfDay(new Date(2026, 10, 1).getTime()));
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
