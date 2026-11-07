/**
 * Conversation UI (review pass 16), driven in node through
 * tests/helpers/dom.js as the pass-15 file is: a fresh DOM and a fresh
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
// The export of a workspace is minutes of network work; the tests hold it and let it go.
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

describe('the pinned bar above a conversation', () => {
  it('keeps the keyboard on its toggle when the count moves under it', async () => {
    const { dom: d, api } = await boot();
    const { createPinBar } = await import('../src/ui/pins.js');
    const msgs = [3, 5].map((seq) => message(seq));
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: msgs });
    store.act.c.c1 = { s: 5, pc: 2 };
    vi.spyOn(api, 'pins').mockResolvedValue({ pins: [] });
    const bar = createPinBar('c1');
    document.body.append(bar.el);
    const toggle = () => bar.el.querySelector('.pin-bar-toggle');
    toggle().focus();
    expect(document.activeElement).toBe(toggle());
    // Someone pins a third message; the poll brings the new count, and the
    // toggle is drawn again with it.
    store.act.c.c1 = { s: 5, pc: 3 };
    store.emit('activity');
    expect(toggle().textContent).toContain('3 pinned');
    expect(document.activeElement).toBe(toggle());
    await d.tick(2);
    bar.destroy();
  });
});

/** A conversation column on #general with three messages, the store's writes stubbed. */
async function openConversation({ pc = 0 } = {}) {
  const { dom: d, api } = await boot();
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  const msgs = [1, 2, 3].map((seq) => message(seq));
  Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: msgs });
  store.me.reads.c1 = 3;
  store.act.c.c1 = { s: 3, pc };
  const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
  document.body.append(view.el);
  await d.tick(5);
  return { d, api, view, msgs };
}

describe('the pinned bar going with its last pin', () => {
  it('hands the keyboard to the newest message when the last pin is unpinned from the bar', async () => {
    const { d, api, view, msgs } = await openConversation({ pc: 1 });
    let pins = [{ seq: 2, by: 'u-me', ts: msgs[1].ts, message: msgs[1] }];
    vi.spyOn(api, 'pins').mockImplementation(async () => ({ pins }));
    vi.spyOn(api, 'unpin').mockImplementation(async () => { pins = []; return {}; });
    view.el.querySelector('.pin-bar-toggle').click();
    await d.tick(5);
    const unpin = view.el.querySelector('.pin-bar [aria-label="Unpin"]');
    expect(unpin).toBeTruthy();
    unpin.focus();
    unpin.click();
    await d.tick(5);
    // The bar is gone with its last pin; the keyboard that was in it is not
    // left on the page body but on the newest message, where a box that goes
    // leaves it too.
    expect(view.el.querySelector('.pin-bar').hidden).toBe(true);
    const rows = [...view.el.querySelectorAll('.msg')];
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    view.destroy();
  });
});

describe('the Members dialog', () => {
  it('keeps the keyboard in the dialog when someone removed from shared channels is restored from it', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.removed = { x1: { name: 'Xu Li', username: 'xu', org: { name: 'Acme' }, at: Date.now() - 60_000 } };
    // The worker takes a moment; its answer takes the person off the list.
    vi.spyOn(api, 'restoreRemoved').mockImplementation(() => new Promise((r) => setTimeout(() => r({}), 3)));
    vi.spyOn(store, 'refreshAfterChange').mockImplementation(async () => { delete store.ws.removed.x1; });
    const { membersDialog } = await import('../src/ui/dialogs.js');
    const { openModal } = await import('../src/ui/modal.js');
    membersDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    const restore = [...content.querySelectorAll('button')].find((b) => b.textContent === 'Restore');
    expect(restore).toBeTruthy();
    restore.focus();
    restore.click();
    // The keyboard stays on the button while the worker answers (busy, not disabled)...
    expect(restore.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(restore);
    await d.tick(10);
    // ...and, the row gone with the answer, lands on a control of the dialog
    // rather than on the page body.
    expect(content.textContent).not.toContain('Xu Li');
    expect(document.activeElement).not.toBe(document.body);
    expect(content.contains(document.activeElement)).toBe(true);
  });
});

describe('the Guests dialog', () => {
  it('takes one press at a time on Make member and Revoke while the question is up and the worker answers', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.members.g1 = { role: 'guest', name: 'Gus Guest', username: 'gus', color: 4 };
    vi.spyOn(api, 'guests').mockResolvedValue({ guests: [{ uuid: 'g1', channels: ['c1'], joinedAt: 1 }] });
    // The worker takes a moment over each.
    const slow = () => new Promise((r) => setTimeout(() => r({}), 5));
    const remove = vi.spyOn(api, 'removeMember').mockImplementation(slow);
    const promote = vi.spyOn(api, 'setRole').mockImplementation(slow);
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const { guestsDialog } = await import('../src/ui/dialogs.js');
    const { confirmDialog } = await import('../src/ui/modal.js');
    guestsDialog();
    await d.tick(5);
    const button = (label) => [...document.querySelectorAll('.pick-item button')].find((b) => b.textContent === label);
    confirmDialog.mockClear(); // the mocked module outlives resetModules; earlier tests' questions are not this one's
    // Two presses of Revoke before the question is even answered: one question, one removal.
    const revoke = button('Revoke');
    expect(revoke).toBeTruthy();
    revoke.click();
    revoke.click();
    await d.tick(2);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(revoke.getAttribute('aria-busy')).toBe('true');
    await d.tick(20);
    expect(remove).toHaveBeenCalledTimes(1);
    // The same for Make member, on the list drawn again.
    const make = button('Make member');
    expect(make).toBeTruthy();
    make.click();
    make.click();
    await d.tick(2);
    expect(confirmDialog).toHaveBeenCalledTimes(2);
    await d.tick(20);
    expect(promote).toHaveBeenCalledTimes(1);
  });
});

describe('the strips redrawn around the pinned bar', () => {
  it('keeps the keyboard on the very pin it was on when a bookmark is added above the bar', async () => {
    const { d, api, view, msgs } = await openConversation({ pc: 2 });
    store.ws.channels.c1.bookmarks = [{ label: 'Roadmap', url: 'https://example.com/roadmap' }];
    store.emit('workspace');
    await d.tick(2);
    const pins = [1, 2].map((seq) => ({ seq, by: 'u-me', ts: msgs[seq - 1].ts, message: msgs[seq - 1] }));
    vi.spyOn(api, 'pins').mockResolvedValue({ pins });
    view.el.querySelector('.pin-bar-toggle').click();
    await d.tick(5);
    const unpins = () => [...view.el.querySelectorAll('.pin-bar [aria-label="Unpin"]')];
    expect(unpins()).toHaveLength(2);
    const second = unpins()[1];
    second.focus();
    // Someone adds a second bookmark: the strips are drawn again with it,
    // and the bar, which stands as it was, is taken off the page and put
    // back among them.
    store.ws.channels.c1.bookmarks = [...store.ws.channels.c1.bookmarks, { label: 'Tracker', url: 'https://example.com/tracker' }];
    store.emit('workspace');
    await d.tick(2);
    expect(view.el.querySelectorAll('.bookmarks-bar a.bookmark')).toHaveLength(2);
    expect(unpins()[1]).toBe(second);
    expect(document.activeElement).toBe(second);
    view.destroy();
  });
});

describe('the Members tab of a channel\'s details', () => {
  it('keeps the roster the newest read brought when an older read lands after it', async () => {
    const { dom: d, api } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal } = await import('../src/ui/modal.js');
    // The worker answers each read of the list when the test says so.
    const loads = [];
    vi.spyOn(api, 'channelMembers').mockImplementation(() => new Promise((resolve) => { loads.push(resolve); }));
    const dialog = openDetailsDialog('c1');
    const content = openModal.mock.calls.at(-1)[0].content;
    [...content.querySelectorAll('.details-tab')].find((t) => t.textContent.startsWith('Members')).click();
    await d.tick(2);
    expect(loads).toHaveLength(1);
    // Someone joins while the first read is out: the tab is built again and the list read again.
    store.ws.channels.c1.count = 4;
    store.emit('workspace');
    await d.tick(2);
    expect(loads).toHaveLength(2);
    // The newer read lands first, with the newcomer; the older one after it, without.
    loads[1]({ members: ['u-me', 'u2', 'u3'] });
    await d.tick(2);
    loads[0]({ members: ['u-me', 'u2'] });
    await d.tick(2);
    const names = () => [...content.querySelectorAll('.member-row strong')].map((n) => n.textContent);
    expect(names()).toEqual(['Me (you)', 'Ana Rocha', 'Ben Ito']);
    // A letter typed into the filter draws the list again from what the tab holds: the newest roster, not the older answer.
    const search = content.querySelector('input[type="search"]');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(names()).toEqual(['Me (you)', 'Ana Rocha', 'Ben Ito']);
    dialog.close();
  });
});

describe('the pinned list while a pinned message changes', () => {
  /** #general with two messages, the newer one pinned; the worker answers each read with the message as it then stands. */
  const pinned = async () => {
    const { dom: d, api } = await boot();
    const m5 = message(5);
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [message(3), m5] });
    store.act.c.c1 = { s: 5, pc: 1 };
    const read = vi.spyOn(api, 'pins').mockImplementation(async () => ({ pins: [{ seq: 5, by: 'u-me', ts: m5.ts, message: { ...m5 } }] }));
    return { d, api, m5, read };
  };
  const correct = (m5) => {
    m5.text = 'm5, corrected';
    m5.editedAt = m5.ts + 1000;
    store.emit('messages', { conv: 'c1', reason: 'range' });
  };

  it('follows an edit of a pinned message in the bar\'s open list, and reads nothing for a message that is not pinned', async () => {
    const { d, m5, read } = await pinned();
    const { createPinBar } = await import('../src/ui/pins.js');
    const bar = createPinBar('c1');
    document.body.append(bar.el);
    bar.el.querySelector('.pin-bar-toggle').click();
    await d.tick(5);
    expect(bar.el.querySelector('.pin-body').textContent).toBe('m5');
    correct(m5);
    await d.tick(5);
    expect(bar.el.querySelector('.pin-body').textContent).toBe('m5, corrected');
    const reads = read.mock.calls.length;
    store.conv('c1').messages.push(message(6));
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [] });
    await d.tick(5);
    expect(read).toHaveBeenCalledTimes(reads);
    bar.destroy();
  });

  it('follows an edit of a pinned message in the channel\'s details too', async () => {
    const { d, m5 } = await pinned();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal } = await import('../src/ui/modal.js');
    const dialog = openDetailsDialog('c1');
    const content = openModal.mock.calls.at(-1)[0].content;
    await d.tick(5);
    expect(content.querySelector('.pinned-section .pin-body').textContent).toBe('m5');
    correct(m5);
    await d.tick(5);
    expect(content.querySelector('.pinned-section .pin-body').textContent).toBe('m5, corrected');
    dialog.close();
  });
});

describe('the message box while a message is being scheduled', () => {
  it('keeps the keyboard on Send later, busy rather than disabled, until the worker has the message', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    let release;
    const later = vi.fn(() => new Promise((r) => { release = r; }));
    const composer = createComposer({ onSend: vi.fn(), onSendLater: later, convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    d.type(composer.textarea, 'see you at nine');
    const laterBtn = composer.el.querySelector('.send-later');
    const sendBtn = composer.el.querySelector('.send-btn');
    expect(laterBtn.disabled).toBe(false);
    laterBtn.focus();
    laterBtn.click(); // the menu of times opens
    const preset = document.querySelector('.menu button.menu-item');
    expect(preset).toBeTruthy();
    preset.click(); // the menu closes onto Send later, and the request goes out
    await d.tick(1);
    expect(later).toHaveBeenCalledTimes(1);
    // The words stay in the box; Send and Send later are off, busy rather
    // than disabled, and the keyboard stays where the menu left it.
    expect(composer.textarea.value).toBe('see you at nine');
    expect(laterBtn.disabled).toBe(false);
    expect(laterBtn.getAttribute('aria-busy')).toBe('true');
    expect(sendBtn.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(laterBtn);
    // A second press meanwhile opens no menu and sends nothing.
    laterBtn.click();
    expect(document.querySelector('.menu')).toBeNull();
    sendBtn.click();
    d.key(composer.textarea, 'Enter');
    expect(later).toHaveBeenCalledTimes(1);
    release({});
    await d.tick(5);
    expect(laterBtn.getAttribute('aria-busy')).toBeNull();
    expect(sendBtn.getAttribute('aria-busy')).toBeNull();
    expect(composer.textarea.value).toBe('');
    expect(document.activeElement).toBe(composer.textarea);
    composer.destroy();
  });
});

describe('an edit whose message is deleted under it', () => {
  it('lands the keyboard on the message\'s own row when it was on the editor\'s Cancel', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    const mine = { ...message(2, 'u-me'), replyCount: 1, lastReplyAt: 1_700_000_000_500 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), mine, message(3)] });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    expect(list.editMessage(mine)).toBe(true);
    // Tab from the box to Cancel; an admin deletes the message meanwhile.
    const cancel = [...list.el.querySelectorAll('.msg-edit-actions button')].find((b) => b.textContent === 'Cancel');
    cancel.focus();
    mine.deleted = true;
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await d.tick(2);
    const row = list.el.querySelector('.msg[data-seq="2"]');
    expect(row.classList.contains('deleted')).toBe(true);
    expect(list.el.querySelector('.msg-edit')).toBeNull();
    // Not the "1 reply" button that happens to stand at Cancel's place among the row's controls.
    expect(document.activeElement).toBe(row);
    list.destroy();
  });
});

describe('joining a shared channel whose host does not answer', () => {
  it('says the channel is joined here and the host out of reach, rather than the network\'s words', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { toast } = await import('../src/ui/toast.js');
    const { ApiError } = await import('../src/lib/api.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.ws.channels.c3 = { id: 'c3', name: 'shared', count: 2, shared: { host: 'Acme', ref: 'ffffff0000@other-server', ch: 'x1' } };
    // The store keeps the join here when the host merely does not answer (see store.joinChannel), and rethrows.
    vi.spyOn(store, 'joinChannel').mockImplementation(async () => {
      store.me.channels.push('c3');
      store.emit('workspace');
      throw new ApiError(0, 'network', 'Failed to fetch');
    });
    const view = createConversationView('c3', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    const join = [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Join #shared');
    expect(join).toBeTruthy();
    toast.mockClear();
    join.click();
    await d.tick(5);
    expect(toast).toHaveBeenCalledTimes(1);
    const [words, opts] = toast.mock.calls[0];
    expect(words).toContain('Joined #shared here');
    expect(words).toContain('Acme could not be reached');
    expect(words).not.toContain('Failed to fetch');
    expect(opts?.icon).not.toBe('alert');
    view.destroy();
  });
});

describe('the bookmarks dialog reordered from the keyboard', () => {
  it('keeps the keyboard on the moved bookmark when its arrow goes quiet at the end of the list', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const ch = store.ws.channels.c1;
    ch.bookmarks = [{ label: 'Roadmap', url: 'https://example.com/roadmap' }, { label: 'Tracker', url: 'https://example.com/tracker' }];
    vi.spyOn(api, 'updateChannel').mockImplementation(async (ref, id, patch) => ({ channel: { ...ch, ...patch } }));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const { bookmarksDialog } = await import('../src/ui/bookmarks.js');
    const { openModal } = await import('../src/ui/modal.js');
    bookmarksDialog(ch);
    const content = openModal.mock.calls.at(-1)[0].content;
    const arrow = (label) => content.querySelector(`.bm-row [aria-label="${label}"]`);
    // Tab to Tracker's "Move up" and press it: Tracker is first now, and its
    // "Move up" has nothing to do. The keyboard stays with Tracker, on its
    // "Move down", rather than landing on Roadmap's "Move up" (which would
    // undo the move on the next press).
    arrow('Move Tracker up').focus();
    arrow('Move Tracker up').click();
    await d.tick(5);
    expect([...content.querySelectorAll('.bm-row strong')].map((n) => n.textContent)).toEqual(['Tracker', 'Roadmap']);
    expect(document.activeElement).toBe(arrow('Move Tracker down'));
    // And back down again: the keyboard follows Tracker to the bottom, onto its "Move up".
    arrow('Move Tracker down').click();
    await d.tick(5);
    expect([...content.querySelectorAll('.bm-row strong')].map((n) => n.textContent)).toEqual(['Roadmap', 'Tracker']);
    expect(document.activeElement).toBe(arrow('Move Tracker up'));
  });

  it('keeps the keyboard with the bookmark when the worker refuses the move and the old order comes back', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const ch = store.ws.channels.c1;
    ch.bookmarks = [{ label: 'Roadmap', url: 'https://example.com/roadmap' }, { label: 'Tracker', url: 'https://example.com/tracker' }];
    // Offline: the save is refused a moment later, and the list goes back to what the worker has.
    vi.spyOn(api, 'updateChannel').mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('You are offline')), 3)));
    const { bookmarksDialog } = await import('../src/ui/bookmarks.js');
    const { openModal } = await import('../src/ui/modal.js');
    bookmarksDialog(ch);
    const content = openModal.mock.calls.at(-1)[0].content;
    const arrow = (label) => content.querySelector(`.bm-row [aria-label="${label}"]`);
    const order = () => [...content.querySelectorAll('.bm-row strong')].map((n) => n.textContent);
    arrow('Move Tracker up').focus();
    arrow('Move Tracker up').click();
    expect(order()).toEqual(['Tracker', 'Roadmap']); // shown at once
    await d.tick(10);
    expect(order()).toEqual(['Roadmap', 'Tracker']); // and back, refused
    // Tracker is at the bottom again, its "Move down" quiet: the keyboard is
    // on its "Move up", not on Roadmap's "Move down" at the same place.
    expect(document.activeElement).toBe(arrow('Move Tracker up'));
  });
});

describe('the Members tab\'s roster read', () => {
  it('is made again for a change of membership, not for a topic or a star', async () => {
    const { dom: d, api } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal } = await import('../src/ui/modal.js');
    const read = vi.spyOn(api, 'channelMembers').mockResolvedValue({ members: ['u-me', 'u2', 'u3'] });
    vi.spyOn(store, 'isStarred').mockReturnValue(false);
    const dialog = openDetailsDialog('c1');
    const content = openModal.mock.calls.at(-1)[0].content;
    [...content.querySelectorAll('.details-tab')].find((t) => t.textContent.startsWith('Members')).click();
    await d.tick(5);
    expect(read).toHaveBeenCalledTimes(1);
    // A new topic, a star: nothing about who is in the channel, and the list stands.
    store.ws.channels.c1.topic = 'Plans for the quarter';
    store.emit('workspace');
    await d.tick(5);
    store.isStarred.mockReturnValue(true);
    store.emit('workspace');
    await d.tick(5);
    expect(read).toHaveBeenCalledTimes(1);
    expect(content.querySelectorAll('.member-row')).toHaveLength(3);
    // Someone joins: the count moves, and the list is read again.
    store.ws.channels.c1.count = 4;
    store.emit('workspace');
    await d.tick(5);
    expect(read).toHaveBeenCalledTimes(2);
    dialog.close();
  });
});

describe('the message list\'s buttons to ask for a page again', () => {
  /** A list of #general whose window has more before it (and, with `newer`, after it). */
  const openList = async ({ newer = false } = {}) => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 9, hasMore: true, hasNewer: newer, messages: [4, 5, 6].map((seq) => message(seq)) });
    store.me.reads.c1 = 9;
    store.act.c.c1 = { s: 9 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // A window with newer messages after it lands by asking for the newest page; the worker is not part of this test.
    vi.spyOn(store, 'jumpToLatest').mockResolvedValue(undefined);
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    return { d, list };
  };

  it('leaves the keyboard on the oldest message when Load older messages is pressed, and there when the page lands', async () => {
    const { d, list } = await openList();
    const conv = store.conv('c1');
    vi.spyOn(store, 'loadOlder').mockImplementation(async () => { conv.loading = true; });
    // The first page could not be fetched: the button to ask again stands at the top.
    store.emit('messages', { conv: 'c1', reason: 'older-failed' });
    const button = () => [...list.el.querySelectorAll('.msg-loader button')].find((b) => b.textContent === 'Load older messages');
    expect(button()).toBeTruthy();
    button().focus();
    button().click();
    await d.tick(2);
    expect(store.loadOlder).toHaveBeenCalledTimes(1);
    expect(button()).toBeUndefined();
    const oldest = () => list.el.querySelector('.msg[data-seq="4"]');
    expect(document.activeElement).toBe(oldest());
    // The page lands above it: the keyboard stays on the message it was on.
    conv.loading = false;
    conv.messages.unshift(message(2), message(3));
    store.emit('messages', { conv: 'c1', reason: 'older' });
    await d.tick(2);
    expect(list.el.querySelectorAll('.msg')).toHaveLength(5);
    expect(document.activeElement).toBe(oldest());
    list.destroy();
  });

  it('leaves the keyboard on the newest message when Load newer messages is pressed', async () => {
    const { d, list } = await openList({ newer: true });
    const conv = store.conv('c1');
    vi.spyOn(store, 'loadNewer').mockImplementation(async () => { conv.loading = true; });
    store.emit('messages', { conv: 'c1', reason: 'newer-failed' });
    const button = () => [...list.el.querySelectorAll('.msg-loader button')].find((b) => b.textContent === 'Load newer messages');
    expect(button()).toBeTruthy();
    button().focus();
    button().click();
    await d.tick(2);
    expect(store.loadNewer).toHaveBeenCalledTimes(1);
    expect(button()).toBeUndefined();
    expect(document.activeElement).toBe(list.el.querySelector('.msg[data-seq="6"]'));
    list.destroy();
  });

  it('keeps the keyboard through Try again: on the button when the load fails again, on the newest message when it lands', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    const conv = store.conv('c1');
    Object.assign(conv, { loaded: false, error: new Error('The server did not answer'), messages: [] });
    store.act.c.c1 = { s: 3 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // What the next load does: nothing (the list's own kick-off), fail again, or land.
    let outcome = null;
    vi.spyOn(store, 'loadConversation').mockImplementation(async () => {
      if (!outcome) return conv;
      conv.loading = true;
      store.emit('messages', { conv: 'c1', reason: 'loading' });
      await d.tick(2);
      conv.loading = false;
      if (outcome === 'ok') {
        Object.assign(conv, { loaded: true, seq: 3, hasMore: false, messages: [1, 2, 3].map((seq) => message(seq)) });
        store.emit('messages', { conv: 'c1', reason: 'init' });
      } else {
        conv.error = new Error('Still nothing');
        store.emit('messages', { conv: 'c1', reason: 'error' });
      }
      return conv;
    });
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(2);
    const retry = () => [...list.el.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    expect(retry()).toBeTruthy();
    // Refused again: the keyboard is on the button to try once more, not on the page body.
    outcome = 'fail';
    const first = retry();
    first.focus();
    first.click();
    await d.tick(1);
    expect(document.activeElement).not.toBe(document.body); // held while the skeleton shows
    await d.tick(10);
    expect(retry()).toBeTruthy();
    expect(retry()).not.toBe(first);
    expect(document.activeElement).toBe(retry());
    // The messages come: the keyboard lands on the newest.
    outcome = 'ok';
    retry().click();
    await d.tick(10);
    const rows = [...list.el.querySelectorAll('.msg')];
    expect(rows).toHaveLength(3);
    expect(document.activeElement).toBe(rows[2]);
    list.destroy();
  });
});

describe('the Workspaces card of a shared channel\'s details', () => {
  it('takes one press at a time on Disconnect while the question is up and the worker answers', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.channels.c1.connections = { k1: { name: 'Acme', ref: 'ffffff0000@other-server', count: 2 } };
    const disconnected = vi.spyOn(api, 'disconnectPartner').mockImplementation(() => new Promise((r) => setTimeout(() => r({}), 5)));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { openModal, confirmDialog } = await import('../src/ui/modal.js');
    const dialog = openDetailsDialog('c1');
    const content = openModal.mock.calls.at(-1)[0].content;
    const disconnect = [...content.querySelectorAll('.org-list button')].find((b) => b.textContent === 'Disconnect');
    expect(disconnect).toBeTruthy();
    // Two presses before the question is even answered: one question, one disconnect.
    confirmDialog.mockClear(); // the mocked module outlives resetModules; earlier tests' questions are not this one's
    disconnect.click();
    disconnect.click();
    await d.tick(2);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(disconnect.getAttribute('aria-busy')).toBe('true');
    await d.tick(20);
    expect(disconnected).toHaveBeenCalledTimes(1);
    dialog.close();
  });
});

describe('deleting a message from its row', () => {
  it('asks once and deletes once when Delete is pressed twice before the worker answers', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    const { confirmDialog } = await import('../src/ui/modal.js');
    const mine = message(2, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), mine, message(3)] });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // The worker takes a moment over the deletion.
    const removed = vi.spyOn(store, 'remove').mockImplementation(() => new Promise((r) => setTimeout(() => r({}), 5)));
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const row = list.el.querySelector('.msg[data-seq="2"]');
    row.focus();
    confirmDialog.mockClear();
    d.key(row, 'Delete');
    d.key(row, 'Delete');
    await d.tick(2);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    await d.tick(20);
    expect(removed).toHaveBeenCalledTimes(1);
    list.destroy();
  });
});

describe('the thread panel\'s Try again', () => {
  it('keeps the keyboard on the button when the thread cannot be loaded once more', async () => {
    const { dom: d, api } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    const { ApiError } = await import('../src/lib/api.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // The thread's message is out of the loaded window, and the worker is out of reach.
    Object.assign(store.conv('c1'), { loaded: true, seq: 9, hasMore: true, messages: [message(8), message(9)] });
    store.act.c.c1 = { s: 9 };
    vi.spyOn(api, 'messages').mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new ApiError(0, 'network', 'The server did not answer')), 3)));
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(10);
    const retry = () => [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    expect(retry()).toBeTruthy();
    const first = retry();
    first.focus();
    first.click();
    await d.tick(1);
    // Held while "Loading thread" shows, not dropped to the page body...
    expect(document.activeElement).not.toBe(document.body);
    await d.tick(10);
    // ...and on the button to try once more when the load is refused again.
    expect(retry()).toBeTruthy();
    expect(retry()).not.toBe(first);
    expect(document.activeElement).toBe(retry());
    thread.destroy();
  });
});

describe('the invite dialogs\' link buttons', () => {
  /** The workspace invite dialog, open on its link tab with a live link, as an admin. */
  const openInvite = async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    Object.assign(store.ws, { invite: 'ABCD-EFGH-IJKL', inviteExp: Date.now() + 86_400_000 });
    const { inviteDialog } = await import('../src/ui/dialogs.js');
    const { openModal, confirmDialog } = await import('../src/ui/modal.js');
    confirmDialog.mockClear();
    inviteDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    const button = (label) => [...content.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
    return { d, api, content, button };
  };

  it('leave the keyboard on the Replace standing where the pressed one was, after the link is replaced', async () => {
    const { d, api, button } = await openInvite();
    vi.spyOn(api, 'updateWorkspace').mockImplementation(() => new Promise((r) => setTimeout(() => r({ workspace: { invite: 'MNOP-QRST-UVWX', inviteExp: Date.now() + 30 * 86_400_000 } }), 3)));
    const replace = button('Replace');
    expect(replace).toBeTruthy();
    replace.focus();
    replace.click(); // the menu of durations opens, the keyboard in it
    const thirty = [...document.querySelectorAll('.menu button')].find((b) => b.textContent.includes('30 days'));
    expect(thirty).toBeTruthy();
    thirty.click(); // the menu closes onto Replace, the question is answered, the request goes out
    await d.tick(1);
    // Busy, not disabled, while the worker answers: the keyboard stays on the button.
    expect(replace.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(replace);
    await d.tick(10);
    // The dialog is drawn again with the new link: the keyboard is on the Replace now standing there.
    expect(button('Replace')).toBeTruthy();
    expect(button('Replace')).not.toBe(replace);
    expect(document.activeElement).toBe(button('Replace'));
  });

  it('leave the keyboard in the dialog after the link is deactivated', async () => {
    const { d, api, content, button } = await openInvite();
    vi.spyOn(api, 'updateWorkspace').mockImplementation(() => new Promise((r) => setTimeout(() => r({ workspace: { invite: null, inviteExp: null } }), 3)));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const deactivate = button('Deactivate');
    expect(deactivate).toBeTruthy();
    deactivate.focus();
    deactivate.click();
    await d.tick(1);
    expect(deactivate.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(deactivate);
    await d.tick(10);
    expect(button('Create an invite link')).toBeTruthy();
    expect(document.activeElement).not.toBe(document.body);
    expect(content.contains(document.activeElement)).toBe(true);
  });
});

describe('the start buttons of the long-running dialogs', () => {
  it('keep the keyboard on Export now while the export runs and after it stops', async () => {
    const { dom: d } = await boot();
    const { exportWorkspace } = await import('../src/lib/archive.js');
    exportWorkspace.mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('The drive is full')), 3)));
    const { exportDialog } = await import('../src/ui/dialogs.js');
    const { openModal } = await import('../src/ui/modal.js');
    exportDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    const start = [...content.querySelectorAll('button')].find((b) => b.textContent === 'Export now');
    expect(start).toBeTruthy();
    start.focus();
    start.click();
    start.click(); // a second press while the first runs
    expect(exportWorkspace).toHaveBeenCalledTimes(1);
    expect(start.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(start);
    await d.tick(10);
    expect(content.textContent).toContain('Stopped: The drive is full');
    expect(start.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(start);
  });

  it('keep the keyboard on Build index while the index is built and after it stops', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const reindex = vi.spyOn(api, 'reindex').mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('The worker did not answer')), 3)));
    const { searchIndexDialog } = await import('../src/ui/dialogs.js');
    const { openModal } = await import('../src/ui/modal.js');
    searchIndexDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    const start = [...content.querySelectorAll('button')].find((b) => b.textContent === 'Build index');
    expect(start).toBeTruthy();
    start.focus();
    start.click();
    start.click();
    expect(reindex).toHaveBeenCalledTimes(1);
    expect(start.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(start);
    await d.tick(10);
    expect(content.textContent).toContain('Stopped: The worker did not answer');
    expect(start.textContent).toBe('Try again');
    expect(start.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(start);
  });
});
