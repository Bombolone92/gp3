/**
 * Conversation UI (review pass 14), driven in node through
 * tests/helpers/dom.js as the pass-13 file is: a fresh DOM and a fresh
 * module registry for every test, Puter faked at `puter.workers.exec`, the
 * toast, the theme, the modal layer and navigation mocked.
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
// The move of a workspace to another server takes minutes of network work; the tests hold it and let it go.
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

afterEach(async () => {
  // The views' own frame-later work (a box's sizing, a list's landing) lands
  // while the page is still up, so no timer runs on a page that is gone.
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

const message = (seq, user = 'u2') => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

/** Give the fake scroller a size, so the reader can stand away from the bottom. */
function sizeScroller(scroller, { height = 1000, viewport = 500 } = {}) {
  Object.defineProperty(scroller, 'scrollHeight', { value: height, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: viewport, configurable: true });
}

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

  it('keeps the keyboard in the reply box when the box is rebuilt around it', async () => {
    const { d, panel, thread } = await openThread();
    const textarea = panel.querySelector('textarea');
    textarea.focus();
    textarea.value = 'half a reply';
    textarea.dispatchEvent(new Event('input'));
    textarea.setSelectionRange(4, 4);
    expect(panel.querySelector('.also-send')).toBeTruthy();
    // An admin keeps posting in the channel to admins: replies stay open to
    // everyone, so the box stays, rebuilt without its "Also send to" row.
    store.ws.channels.c1.postPolicy = 'admins';
    store.emit('workspace');
    const again = panel.querySelector('textarea');
    expect(again).toBeTruthy();
    expect(panel.querySelector('.also-send')).toBeNull();
    expect(again.value).toBe('half a reply');
    expect(document.activeElement).toBe(again);
    await d.tick(2);
    expect(document.activeElement).toBe(again);
    // Opened up again: the row is back, and the keyboard is still in the box.
    store.ws.channels.c1.postPolicy = 'members';
    store.emit('workspace');
    const back = panel.querySelector('textarea');
    expect(panel.querySelector('.also-send')).toBeTruthy();
    expect(back.value).toBe('half a reply');
    expect(document.activeElement).toBe(back);
    await d.tick(2); // the box's own zero-delay sizing lands while the page is still up
    thread.destroy();
  });

  it('is not redrawn for a message posted in the channel around it, only when its own message changes', async () => {
    const { d, panel, thread, root } = await openThread();
    const conv = store.conv('c1');
    const rowOf = () => panel.querySelector('.msg.thread-root');
    const before = rowOf();
    expect(before).toBeTruthy();
    // Someone posts in the channel: the thread stands as it is.
    conv.messages.push(message(6));
    conv.seq = 6;
    store.act.c.c1 = { s: 6 };
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [message(6)] });
    await d.tick(2);
    expect(rowOf()).toBe(before);
    // A reaction on the root itself: redrawn.
    root.reactions = { '+1': { u2: 1 } };
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    expect(rowOf()).not.toBe(before);
    expect(rowOf().querySelector('.reaction')).toBeTruthy();
    // And its reply count moving.
    const second = rowOf();
    root.replyCount = 1;
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    expect(rowOf()).not.toBe(second);
    expect(panel.querySelector('.thread-count').textContent).toBe('1 reply');
    thread.destroy();
  });
});

describe('the conversation column while the channel changes under it', () => {
  const openConversation = async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.conv('c1'), { loaded: true, seq: 6, hasMore: false, messages: [1, 2, 3, 4, 5, 6].map(message) });
    store.me.reads.c1 = 6;
    store.act.c.c1 = { s: 6 };
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    return { d, view };
  };

  it('keeps the list where the reader left it, and the keyboard where it was, when only the box is concerned', async () => {
    const { d, view } = await openConversation();
    const wrap = view.el.querySelector('.msg-wrap');
    const scroller = view.el.querySelector('.msg-scroll');
    sizeScroller(scroller);
    scroller.scrollTop = 120; // reading older messages
    // The keyboard is elsewhere: the sidebar, the search box.
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    // An admin turns thread replies off in the channel.
    store.ws.channels.c1.threadPolicy = 'off';
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelector('.msg-wrap')).toBe(wrap);
    expect(scroller.scrollTop).toBe(120);
    expect(document.activeElement).toBe(elsewhere);
    // And when the box itself goes and comes back.
    store.ws.channels.c1.postPolicy = 'admins';
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelector('textarea')).toBeNull();
    expect(view.el.querySelector('.msg-wrap')).toBe(wrap);
    expect(document.activeElement).toBe(elsewhere);
    store.ws.channels.c1.postPolicy = 'members';
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelector('textarea')).toBeTruthy();
    expect(view.el.querySelector('.msg-wrap')).toBe(wrap);
    expect(document.activeElement).toBe(elsewhere);
    view.destroy();
  });

  it('keeps the list where the reader left it when the reader\'s own role changes', async () => {
    const { d, view } = await openConversation();
    const wrap = view.el.querySelector('.msg-wrap');
    const scroller = view.el.querySelector('.msg-scroll');
    sizeScroller(scroller);
    scroller.scrollTop = 120;
    // Made an admin: the box is the same box (the channel takes everyone's posts), the list stands.
    store.ws.members['u-me'].role = 'admin';
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelector('.msg-wrap')).toBe(wrap);
    expect(scroller.scrollTop).toBe(120);
    view.destroy();
  });

  it('keeps the keyboard in the box, with its words, when the box is rebuilt around it', async () => {
    const { d, view } = await openConversation();
    const textarea = view.el.querySelector('textarea');
    textarea.focus();
    textarea.value = 'half a message';
    textarea.dispatchEvent(new Event('input'));
    store.ws.channels.c1.threadPolicy = 'admins';
    store.emit('workspace');
    await d.tick(5);
    const again = view.el.querySelector('textarea');
    expect(again.value).toBe('half a message');
    expect(document.activeElement).toBe(again);
    // The box goes from under the keyboard: it lands on the newest message, not on the page body.
    store.ws.channels.c1.postPolicy = 'admins';
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelector('textarea')).toBeNull();
    const rows = [...view.el.querySelectorAll('.msg')];
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    view.destroy();
  });
});

describe('joining a channel from its preview bar', () => {
  const openPreview = async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.me.channels = ['c2']; // previewing #general, not in it
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [1, 2, 3].map(message) });
    store.act.c.c1 = { s: 3 };
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    expect(view.el.querySelector('textarea')).toBeNull();
    const join = [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Join #general');
    return { d, view, join };
  };

  it('lands the keyboard in the box that takes the bar\'s place', async () => {
    const { d, view, join } = await openPreview();
    vi.spyOn(store, 'joinChannel').mockImplementation(async () => {
      store.me.channels.push('c1');
      store.emit('workspace');
    });
    join.focus();
    join.click();
    await d.tick(5);
    const box = view.el.querySelector('textarea');
    expect(box).toBeTruthy();
    expect(document.activeElement).toBe(box);
    view.destroy();
  });

  it('keeps the keyboard on Join while the worker answers, and on it when the join is refused', async () => {
    const { d, view, join } = await openPreview();
    let refuse = null;
    const joinChannel = vi.spyOn(store, 'joinChannel').mockImplementation(() => new Promise((_, reject) => { refuse = reject; }));
    join.focus();
    join.click();
    join.click(); // a second press while the first is out
    expect(joinChannel).toHaveBeenCalledTimes(1);
    expect(join.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(join);
    refuse(new Error('You are offline'));
    await d.tick(5);
    expect(join.getAttribute('aria-busy')).toBeNull();
    expect(join.disabled).toBe(false);
    expect(document.activeElement).toBe(join);
    view.destroy();
  });
});

describe('the edit box\'s Save button', () => {
  it('keeps the keyboard while the worker answers, and when the edit is refused', async () => {
    await boot();
    const { renderMessage, startInlineEdit } = await import('../src/ui/message.js');
    const msg = message(7, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    expect(startInlineEdit(row)).toBe(true);
    let refuse = null;
    const edit = vi.spyOn(store, 'edit').mockImplementation(() => new Promise((_, reject) => { refuse = reject; }));
    row.querySelector('.msg-edit-input').value = 'm7, corrected';
    const save = row.querySelector('.msg-edit-actions .btn-primary');
    save.focus(); // Tab from the box to Save, then Space
    save.click();
    save.click(); // a second press while the first is out
    expect(edit).toHaveBeenCalledTimes(1);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(save);
    refuse(new Error('You are offline'));
    await new Promise((r) => setTimeout(r, 2));
    expect(save.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(save);
    expect(row.classList.contains('editing')).toBe(true); // the words stay, to try again
  });
});

describe('an edit open on a message when the list jumps elsewhere', () => {
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

  it('says the message is out of view, not deleted, while another window loads', async () => {
    const { d, list, toast } = await openEdit();
    // "Jump to a date" from the date pill: the store empties the window and
    // says it is loading, then fills it around the day asked for.
    const conv = store.conv('c1');
    conv.loaded = false;
    conv.messages = [];
    store.emit('messages', { conv: 'c1', reason: 'loading' });
    expect(list.el.querySelector('.msg-edit-input')).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('Editing stopped: the message is out of view now. Nothing was changed');
    await d.tick(2); // the list's own frame-later work lands while the page is still up
    list.destroy();
  });

  it('says the message is out of view when the window that arrives never held it', async () => {
    const { d, list, toast } = await openEdit();
    const conv = store.conv('c1');
    Object.assign(conv, { loaded: true, seq: 12, hasMore: true, hasNewer: false, messages: [10, 11, 12].map(message) });
    store.emit('messages', { conv: 'c1', reason: 'init' });
    await d.tick(2);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('Editing stopped: the message is out of view now. Nothing was changed');
    list.destroy();
  });

  it('says deleted, not out of view, when a thread\'s own message is deleted under an edit of it at the top of the thread', async () => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    const { startInlineEdit } = await import('../src/ui/message.js');
    const { toast } = await import('../src/ui/toast.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const root = message(5, 'u-me');
    root.replyCount = 0;
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [root] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    store.act.c.c1 = { s: 5 };
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(5);
    expect(startInlineEdit(panel.querySelector('.msg.thread-root'))).toBe(true);
    const input = panel.querySelector('.msg-edit-input');
    input.focus();
    input.value = 'm5, with a correction';
    input.dispatchEvent(new Event('input'));
    toast.mockClear();
    // An admin deletes it elsewhere.
    root.deleted = true;
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    expect(panel.querySelector('.msg-edit-input')).toBeNull();
    expect(toast).toHaveBeenCalledWith('That message was deleted while you were editing it', { icon: 'alert' });
    thread.destroy();
  });

  it('still says deleted when the window kept its place and the message left it', async () => {
    const { d, list, mine, toast } = await openEdit();
    store.conv('c1').messages = store.conv('c1').messages.filter((m) => m !== mine);
    store.emit('messages', { conv: 'c1', reason: 'range' });
    expect(toast).toHaveBeenCalledWith('That message was deleted while you were editing it', { icon: 'alert' });
    await d.tick(2);
    list.destroy();
  });
});

describe('the emoji picker\'s arrow keys', () => {
  const key = (node, k, init = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(e);
    return e;
  };

  it('leave a modified arrow and an IME arrow to their owners, in the grid, the tone list and the search box', async () => {
    const { dom: d } = await boot();
    const { openEmojiPicker } = await import('../src/ui/emojipicker.js');
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const pop = openEmojiPicker(anchor, { onPick: vi.fn() });
    await d.tick(2);
    // The grid: Alt+Right is the app's (or the browser's), Right is the grid's.
    const cells = [...document.querySelectorAll('.emoji-cell')];
    cells[0].focus();
    expect(key(cells[0], 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(cells[0]);
    expect(key(cells[0], 'ArrowRight', { isComposing: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(cells[0]);
    expect(key(cells[0], 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cells[1]);
    // The search box: Down during a composition picks the IME's candidate, not the first emoji.
    const search = document.querySelector('.emoji-search');
    search.focus();
    d.type(search, 'wav');
    expect(key(search, 'ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search);
    expect(key(search, 'ArrowDown', { metaKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search);
    key(search, 'ArrowDown');
    expect(document.activeElement.classList.contains('emoji-cell')).toBe(true);
    // The tone list: the same.
    document.querySelector('.emoji-tone').click();
    const tones = [...document.querySelectorAll('.emoji-tones button')];
    expect(document.activeElement).toBe(tones[0]);
    expect(key(tones[0], 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tones[0]);
    key(tones[0], 'ArrowRight');
    expect(document.activeElement).toBe(tones[1]);
    await d.tick(2);
    pop.close();
  });
});

describe('a message box destroyed with the keyboard in it', () => {
  it('sets no timer when the keyboard then leaves it', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    const composer = createComposer({ onSend: async () => {}, convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const other = document.createElement('button');
    document.body.append(other);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    // Alive, the box waits a moment after losing the keyboard before it closes its mention list.
    composer.textarea.focus();
    other.focus();
    expect(timers.mock.calls.some(([, ms]) => ms === 120)).toBe(true);
    timers.mockClear();
    // Destroyed with the keyboard in it (the conversation switched, the box
    // rebuilt), and the keyboard leaving as the box goes: nothing is left to
    // run on a view that no longer exists.
    composer.textarea.focus();
    composer.destroy();
    composer.el.remove();
    other.focus();
    expect(timers.mock.calls.some(([, ms]) => ms === 120)).toBe(false);
  });
});

describe('taking over a workspace while the move runs', () => {
  it('says the move carries on when the dialog is closed, shows it again when reopened, and closes that one when it is done', async () => {
    const { dom: d } = await boot();
    const { acceptTransferDialog } = await import('../src/ui/dialogs.js');
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    const { navigate } = await import('../src/lib/router.js');
    toast.mockClear(); // the mocked modules outlive the module registry's reset
    navigate.mockClear();
    store.ws.owner = 'u2';
    store.ws.transferTo = 'u-me';
    vi.spyOn(store, 'ensureOwnWorker').mockResolvedValue({ url: 'https://mine.test' });
    vi.spyOn(store, 'profileSeed').mockReturnValue({});
    vi.spyOn(store, '_addWorkspace').mockResolvedValue(undefined);
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    let finish = null;
    archive.transferWorkspace.mockImplementation((ref, url, state, { onProgress }) => new Promise((resolve) => {
      onProgress({ phase: 'read', label: 'Reading the workspace' });
      finish = resolve;
    }));
    const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
    const status = () => document.querySelector('[role="status"]');
    acceptTransferDialog();
    const start = button('Accept and move it here');
    start.focus();
    start.click();
    await d.tick(2);
    expect(archive.transferWorkspace).toHaveBeenCalledTimes(1);
    expect(start.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(start); // busy, not disabled: the keyboard stays
    expect(status().textContent).toMatch(/Reading the workspace/);
    // Closed while it runs (the button now reads Close; Escape and the scrim
    // take the same way out): the move goes on, and the reader is told so.
    expect(button('Not now')).toBeUndefined();
    button('Close').click();
    expect(status()).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatch(/carries on in the background/);
    // Opened again from the banner's Review: the progress is there, and the move is not offered a second time.
    acceptTransferDialog();
    expect(status().textContent).toMatch(/Reading the workspace/);
    const again = button('Accept and move it here');
    expect(again.getAttribute('aria-busy')).toBe('true');
    again.click();
    await d.tick(2);
    expect(archive.transferWorkspace).toHaveBeenCalledTimes(1);
    // Done: the dialog showing the move closes with it, and the reader goes to the new server.
    finish({ ref: 'new@mine', mine: true, icon: null });
    await d.tick(5);
    expect(status()).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ ws: 'new@mine' });
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[1][0]).toMatch(/now yours/);
  });
});

describe('a dialog\'s submit button pressed from the keyboard', () => {
  it('gets the keyboard back when the worker refuses', async () => {
    const { api } = await boot();
    const { createChannelDialog } = await import('../src/ui/dialogs.js');
    const { toast } = await import('../src/ui/toast.js');
    vi.spyOn(api, 'createChannel').mockRejectedValue(new Error('You are offline'));
    createChannelDialog();
    const form = document.querySelector('form');
    form.querySelector('input').value = 'design-reviews';
    const submit = form.querySelector('button[type="submit"]');
    submit.focus(); // Tab to the button, then Space
    submit.click();
    expect(submit.disabled).toBe(true);
    await new Promise((r) => setTimeout(r, 2));
    expect(toast).toHaveBeenCalledWith('You are offline', { icon: 'alert' });
    expect(submit.disabled).toBe(false);
    expect(document.activeElement).toBe(submit);
  });

  it('leaves the keyboard on the field an error was shown under', async () => {
    const { api } = await boot();
    const { createChannelDialog } = await import('../src/ui/dialogs.js');
    vi.spyOn(api, 'createChannel').mockRejectedValue(Object.assign(new Error('A channel with that name exists'), { code: 'exists' }));
    createChannelDialog();
    const form = document.querySelector('form');
    const name = form.querySelector('input');
    name.value = 'general';
    const submit = form.querySelector('button[type="submit"]');
    submit.focus();
    submit.click();
    await new Promise((r) => setTimeout(r, 2));
    expect(document.activeElement).toBe(name);
  });
});
