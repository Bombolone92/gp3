/**
 * Conversation UI (review pass 15), driven in node through
 * tests/helpers/dom.js as the pass-14 file is: a fresh DOM and a fresh
 * module registry for every test, Puter faked at `puter.workers.exec`, the
 * toast, the theme, the modal layer and navigation mocked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
/** Wait, polling, until `fn()` holds: a fixed pause after a mocked worker's few-millisecond delay is flaky under a full parallel run. */
const until = async (d, fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await d.tick(5); } };

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

describe('the thread panel\'s own message at its top', () => {
  const openThread = async () => {
    const { dom: d, api } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const root = message(5);
    root.replyCount = 0;
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [root] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    store.act.c.c1 = { s: 5 };
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(5);
    return { d, api, panel, thread, root };
  };

  it('shows the message saved when it is saved from the thread', async () => {
    const { d, api, panel, thread } = await openThread();
    vi.spyOn(api, 'save').mockResolvedValue({});
    vi.spyOn(api, 'unsave').mockResolvedValue({});
    const bookmark = () => panel.querySelector('.msg.thread-root .msg-actions [aria-label="Save for later"], .msg.thread-root .msg-actions [aria-label="Remove from Later"]');
    expect(bookmark().getAttribute('aria-pressed')).toBe('false');
    bookmark().click();
    await d.tick(5);
    expect(store.isSaved('c1', 5)).toBe(true);
    // The row is redrawn for what changed about it: the bookmark reads as
    // pressed, and offers the way back.
    expect(bookmark().getAttribute('aria-pressed')).toBe('true');
    expect(bookmark().getAttribute('aria-label')).toBe('Remove from Later');
    bookmark().click();
    await d.tick(5);
    expect(store.isSaved('c1', 5)).toBe(false);
    expect(bookmark().getAttribute('aria-pressed')).toBe('false');
    thread.destroy();
  });

  it('follows a rename of the channel in its head and under the reply box', async () => {
    const { d, panel, thread } = await openThread();
    expect(panel.querySelector('.panel-head .panel-sub').textContent).toBe('#general');
    expect(panel.querySelector('.also-send span').textContent).toBe('Also send to #general');
    store.ws.channels.c1.name = 'announcements';
    store.emit('workspace');
    expect(panel.querySelector('.panel-head .panel-sub').textContent).toBe('#announcements');
    expect(panel.querySelector('.also-send span').textContent).toBe('Also send to #announcements');
    await d.tick(2);
    thread.destroy();
  });

  it('keeps the last name in its head when the channel is deleted under it', async () => {
    const { d, panel, thread } = await openThread();
    expect(panel.querySelector('.panel-head .panel-sub').textContent).toBe('#general');
    delete store.ws.channels.c1;
    store.me.channels = ['c2'];
    store.emit('workspace');
    expect(panel.querySelector('.panel-head .panel-sub').textContent).toBe('#general');
    await d.tick(2);
    thread.destroy();
  });

  it('keeps the "Also send to" tick when the reply box is rebuilt around it', async () => {
    const { d, panel, thread } = await openThread();
    const also = () => panel.querySelector('.also-send input');
    expect(also().checked).toBe(false);
    also().click();
    expect(also().checked).toBe(true);
    // An admin keeps posting in the channel to admins, then opens it again:
    // the row goes with the first change and comes back with the second.
    store.ws.channels.c1.postPolicy = 'admins';
    store.emit('workspace');
    expect(also()).toBeNull();
    store.ws.channels.c1.postPolicy = 'members';
    store.emit('workspace');
    expect(also()).toBeTruthy();
    expect(also().checked).toBe(true);
    await d.tick(2);
    thread.destroy();
  });
});

describe('the keyboard in a list redrawn while an edit is open', () => {
  const openEdit = async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
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
    input.value = 'm2, with a correction';
    input.dispatchEvent(new Event('input'));
    return { d, list };
  };

  it('stays on the edit box\'s Save button through a teammate\'s reaction', async () => {
    const { d, list } = await openEdit();
    // Tab from the box to Save; a reaction lands elsewhere and redraws the list.
    list.el.querySelector('.msg-edit-actions .btn-primary').focus();
    store.conv('c1').messages[2].reactions = { '+1': { u3: 1 } };
    store.emit('messages', { conv: 'c1', reason: 'range' });
    const again = list.el.querySelector('.msg-edit-actions .btn-primary');
    expect(again).toBeTruthy();
    expect(list.el.querySelector('.msg-edit-input').value).toBe('m2, with a correction');
    expect(document.activeElement).toBe(again);
    await d.tick(2);
    list.destroy();
  });

  it('stays on a control of another row through the redraw its press brings', async () => {
    const { d, list } = await openEdit();
    // The edit stands open on one row; the keyboard is on another row's toolbar.
    const reply = () => [...list.el.querySelectorAll('.msg[data-seq="3"] .msg-actions button')].find((b) => b.getAttribute('aria-label') === 'Reply in thread');
    reply().focus();
    store.conv('c1').messages[2].reactions = { '+1': { u3: 1 } };
    store.emit('messages', { conv: 'c1', reason: 'range' });
    expect(list.el.querySelector('.msg-edit-input')).toBeTruthy();
    expect(document.activeElement).toBe(reply());
    await d.tick(2);
    list.destroy();
  });
});

describe('the pinned bar above a conversation', () => {
  it('reads the pins once when one is unpinned from it, and keeps the keyboard in the list', async () => {
    const { dom: d, api } = await boot();
    const { createPinBar } = await import('../src/ui/pins.js');
    const m3 = message(3);
    const m5 = message(5);
    const m7 = message(7);
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [m3, m5, m7] });
    store.act.c.c1 = { s: 7, pc: 3 };
    let pins = [3, 5, 7].map((seq) => ({ seq, by: 'u-me', ts: 1_700_000_000_000 + seq, message: [m3, m5, m7].find((m) => m.seq === seq) }));
    // The worker takes a moment to answer, as it does over a network.
    const read = vi.spyOn(api, 'pins').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ pins }), 3)));
    vi.spyOn(api, 'unpin').mockImplementation(async (ref, conv, seq) => { pins = pins.filter((p) => p.seq !== seq); return {}; });
    const bar = createPinBar('c1');
    document.body.append(bar.el);
    bar.el.querySelector('.pin-bar-toggle').click();
    await d.tick(5);
    expect(read).toHaveBeenCalledTimes(1);
    const unpins = () => [...bar.el.querySelectorAll('[aria-label="Unpin"]')];
    expect(unpins()).toHaveLength(3);
    // Tab to the second pin's Unpin and press it.
    unpins()[1].focus();
    unpins()[1].click();
    await until(d, () => unpins().length === 2);
    expect(bar.el.querySelector('.pin-bar-toggle').textContent).toContain('2 pinned');
    expect(unpins()).toHaveLength(2);
    // One read of the list for the one change, not one per listener that heard of it.
    expect(read).toHaveBeenCalledTimes(2);
    // The keyboard stays in the list, on the pin now standing at that place.
    expect(document.activeElement).toBe(unpins()[1]);
    bar.destroy();
  });

  it('reads nothing more once the bar is gone, even for a change heard while a read was out', async () => {
    const { dom: d, api } = await boot();
    const { createPinBar } = await import('../src/ui/pins.js');
    const msgs = [3, 5, 7].map((seq) => message(seq));
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: msgs });
    store.act.c.c1 = { s: 7, pc: 3 };
    const pins = msgs.map((m) => ({ seq: m.seq, by: 'u-me', ts: m.ts, message: m }));
    const read = vi.spyOn(api, 'pins').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ pins }), 5)));
    const bar = createPinBar('c1');
    document.body.append(bar.el);
    bar.el.querySelector('.pin-bar-toggle').click(); // the read goes out
    // The count moves while it is out: a read once more is owed when it lands.
    store.act.c.c1 = { s: 7, pc: 2 };
    store.emit('activity');
    // The reader leaves the conversation before it lands.
    bar.destroy();
    await d.tick(20);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('says the list is loading when the bar is closed and opened again while a read is out', async () => {
    const { dom: d, api } = await boot();
    const { createPinBar } = await import('../src/ui/pins.js');
    const msgs = [3, 5, 7].map((seq) => message(seq));
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: msgs });
    store.act.c.c1 = { s: 7, pc: 3 };
    const pins = msgs.map((m) => ({ seq: m.seq, by: 'u-me', ts: m.ts, message: m }));
    const read = vi.spyOn(api, 'pins').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ pins }), 5)));
    const bar = createPinBar('c1');
    document.body.append(bar.el);
    const toggle = () => bar.el.querySelector('.pin-bar-toggle');
    toggle().click(); // open: the read goes out
    toggle().click(); // closed again
    toggle().click(); // and open, the read still out
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(bar.el.querySelector('.pin-bar-body .msg-loader')).toBeTruthy();
    await d.tick(20);
    expect(bar.el.querySelectorAll('.pin-row')).toHaveLength(3);
    expect(read).toHaveBeenCalledTimes(1);
    bar.destroy();
  });
});

describe('Escape during an IME composition', () => {
  const key = (node, k, init = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(e);
    return e;
  };

  it('cancels the word being composed in an edit box, not the edit', async () => {
    await boot();
    const { renderMessage, startInlineEdit } = await import('../src/ui/message.js');
    const msg = message(7, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    expect(startInlineEdit(row)).toBe(true);
    const input = row.querySelector('.msg-edit-input');
    input.value = 'm7, なお';
    // The IME's Escape: the composition ends, the edit stays with its words.
    expect(key(input, 'Escape', { isComposing: true }).defaultPrevented).toBe(false);
    expect(row.classList.contains('editing')).toBe(true);
    expect(row.querySelector('.msg-edit-input').value).toBe('m7, なお');
    // Safari's shape of the same key.
    key(input, 'Escape', { keyCode: 229 });
    expect(row.classList.contains('editing')).toBe(true);
    // A plain Escape cancels the edit, as before.
    expect(key(input, 'Escape').defaultPrevented).toBe(true);
    expect(row.classList.contains('editing')).toBe(false);
  });

  it('leaves a popover with a text box in it open', async () => {
    const { dom: d } = await boot();
    const { openPopover } = await import('../src/ui/menu.js');
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const input = document.createElement('input');
    const pop = openPopover(anchor, input, { label: 'Add a link' });
    await d.tick(2); // the popover's own listeners are added a moment after it opens
    input.focus();
    expect(key(input, 'Escape', { isComposing: true }).defaultPrevented).toBe(false);
    expect(pop.node.isConnected).toBe(true);
    // Safari's shape of the same key.
    key(input, 'Escape', { keyCode: 229 });
    expect(pop.node.isConnected).toBe(true);
    key(input, 'Escape');
    expect(pop.node.isConnected).toBe(false);
  });
});

describe('the composer\'s mention list', () => {
  const key = (node, k, init = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(e);
    return e;
  };
  const typed = (textarea, text) => {
    textarea.value = text;
    textarea.selectionStart = text.length;
    textarea.selectionEnd = text.length;
    textarea.dispatchEvent(new Event('input'));
  };

  it('leaves a modified arrow and an IME arrow to their owners', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const { textarea } = composer;
    typed(textarea, 'hi @');
    const options = () => [...composer.el.querySelectorAll('.mention-pop [role="option"]')];
    expect(options().length).toBeGreaterThan(1);
    const chosen = () => textarea.getAttribute('aria-activedescendant');
    const first = chosen();
    // A pinyin composition keeps the token in letters, so the list stands
    // while the candidate is picked with the arrows: those are the IME's.
    expect(key(textarea, 'ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
    expect(chosen()).toBe(first);
    // Alt+Down steps to the next conversation, list or no list.
    expect(key(textarea, 'ArrowDown', { altKey: true }).defaultPrevented).toBe(false);
    expect(chosen()).toBe(first);
    // A bare arrow moves the highlight, as before.
    expect(key(textarea, 'ArrowDown').defaultPrevented).toBe(true);
    expect(chosen()).not.toBe(first);
    expect(chosen()).toBe(options()[1].id);
    composer.destroy();
  });
});

describe('the details dialog\'s pinned section', () => {
  it('reads the pins once, and builds the tab once, when one is unpinned from it', async () => {
    const { dom: d, api } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const msgs = [3, 5, 7].map((seq) => message(seq));
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: msgs });
    store.act.c.c1 = { s: 7, pc: 3 };
    let pins = msgs.map((m) => ({ seq: m.seq, by: 'u-me', ts: m.ts, message: m }));
    // The worker takes a moment to answer, as it does over a network.
    const read = vi.spyOn(api, 'pins').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ pins }), 3)));
    vi.spyOn(api, 'unpin').mockImplementation(async (ref, conv, seq) => { pins = pins.filter((p) => p.seq !== seq); return {}; });
    const dialog = openDetailsDialog('c1');
    await d.tick(10);
    expect(read).toHaveBeenCalledTimes(1);
    const unpins = () => [...document.querySelectorAll('.pinned-section [aria-label="Unpin"]')];
    expect(unpins()).toHaveLength(3);
    const built = document.querySelectorAll('.details').length;
    unpins()[1].click();
    await until(d, () => unpins().length === 2);
    expect(unpins()).toHaveLength(2);
    expect(document.querySelector('.pinned-section h3').textContent).toBe('Pinned (2)');
    // One read of the list for the one change, whichever way the dialog heard of it.
    expect(read).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.details').length).toBe(built);
    dialog.close();
  });

  it('keeps the list on show while it is read again, and the keyboard on the pin now at the unpinned one\'s place', async () => {
    const { dom: d, api } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const msgs = [3, 5, 7].map((seq) => message(seq));
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: msgs });
    store.act.c.c1 = { s: 7, pc: 3 };
    let pins = msgs.map((m) => ({ seq: m.seq, by: 'u-me', ts: m.ts, message: m }));
    vi.spyOn(api, 'pins').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ pins }), 5)));
    vi.spyOn(api, 'unpin').mockImplementation(async (ref, conv, seq) => { pins = pins.filter((p) => p.seq !== seq); return {}; });
    const dialog = openDetailsDialog('c1');
    await d.tick(10);
    const unpins = () => [...document.querySelectorAll('.pinned-section [aria-label="Unpin"]')];
    const rows = () => [...document.querySelectorAll('.pinned-section .pin-row')].map((r) => r.querySelector('.pin-body').textContent);
    expect(rows()).toEqual(['m3', 'm5', 'm7']);
    // Tab to the second pin's Unpin and press it.
    unpins()[1].focus();
    unpins()[1].click();
    await d.tick(1);
    // While the fresh list is read, the one on show stays (busy), rather than a "Loading" line in its place.
    expect(rows()).toEqual(['m3', 'm5', 'm7']);
    expect(document.querySelector('.pinned-section .details-card').getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Unpin');
    await until(d, () => rows().length === 2);
    expect(rows()).toEqual(['m3', 'm7']);
    expect(document.querySelector('.pinned-section .details-card').getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(unpins()[1]);
    dialog.close();
  });
});

describe('the details dialog\'s pinned section when the last pin goes', () => {
  it('keeps the keyboard on the section, on its "Nothing pinned yet"', async () => {
    const { dom: d, api } = await boot();
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const m5 = message(5);
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [m5] });
    store.act.c.c1 = { s: 5, pc: 1 };
    let pins = [{ seq: 5, by: 'u-me', ts: m5.ts, message: m5 }];
    vi.spyOn(api, 'pins').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ pins }), 3)));
    vi.spyOn(api, 'unpin').mockImplementation(async (ref, conv, seq) => { pins = pins.filter((p) => p.seq !== seq); return {}; });
    const dialog = openDetailsDialog('c1');
    await d.tick(10);
    const unpin = document.querySelector('.pinned-section [aria-label="Unpin"]');
    expect(unpin).toBeTruthy();
    unpin.focus();
    unpin.click();
    await d.tick(15);
    const section = document.querySelector('.pinned-section');
    expect(section.querySelector('h3').textContent).toBe('Pinned (0)');
    expect(section.querySelector('.pin-empty')).toBeTruthy();
    expect(section.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(section.querySelector('.pin-empty'));
    dialog.close();
  });
});

describe('a popover closed over an anchor drawn only while its row holds the keyboard', () => {
  it('gives the keyboard back to the anchor through its row', async () => {
    const { dom: d } = await boot();
    const { openPopover } = await import('../src/ui/menu.js');
    // A message row with its hover bar: the bar is drawn only while the row
    // is under the pointer or holds the keyboard (see .msg-actions), and a
    // browser will not focus a control that is not drawn. The fake DOM
    // applies no CSS, so both rules are stood in for here.
    const row = document.createElement('div');
    row.setAttribute('tabindex', '0');
    const bar = document.createElement('div');
    const anchor = document.createElement('button');
    anchor.setAttribute('aria-label', 'Add reaction');
    bar.append(anchor);
    row.append(bar);
    document.body.append(row);
    Object.defineProperty(anchor, 'offsetParent', { get: () => (row.contains(document.activeElement) ? bar : null), configurable: true });
    const focus = Object.getPrototypeOf(anchor).focus;
    anchor.focus = function refuseUndrawn(opts) { if (this.offsetParent !== null) focus.call(this, opts); };
    // Reached from the keyboard: the row, then its bar's button, which opens the picker.
    row.focus();
    anchor.focus();
    expect(document.activeElement).toBe(anchor);
    const input = document.createElement('input');
    const pop = openPopover(anchor, input, { label: 'Add a reaction' });
    await d.tick(2);
    expect(document.activeElement).toBe(input);
    expect(anchor.offsetParent).toBeNull(); // the bar is gone with the keyboard
    pop.close();
    expect(document.activeElement).toBe(anchor);
  });
});

describe('a page of messages that could not be fetched', () => {
  it('gives way at once to a button to ask for it again, older and newer alike', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // A window opened around an older message: pages both ways.
    const conv = store.conv('c1');
    Object.assign(conv, { loaded: true, seq: 30, hasMore: true, hasNewer: true, messages: [10, 11, 12].map((seq) => message(seq)) });
    store.act.c.c1 = { s: 30 };
    const loadNewer = vi.spyOn(store, 'loadNewer').mockImplementation(async () => 0);
    const loadOlder = vi.spyOn(store, 'loadOlder').mockImplementation(async () => 0);
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const loaders = () => [...list.el.querySelectorAll('.msg-loader')].map((n) => n.textContent);
    const button = (label) => [...list.el.querySelectorAll('.msg-loader button')].find((b) => b.textContent === label);
    // The store says the page failed from inside the request's failure, a
    // moment before it lets go of the conversation's loading flag.
    conv.loading = true;
    store.emit('messages', { conv: 'c1', reason: 'newer-failed' });
    expect(loaders()).not.toContain('Loading newer messages');
    expect(button('Load newer messages')).toBeTruthy();
    conv.loading = false;
    button('Load newer messages').click();
    expect(loadNewer).toHaveBeenCalledWith('c1');
    // The same for a page of older messages.
    conv.loading = true;
    store.emit('messages', { conv: 'c1', reason: 'older-failed' });
    expect(loaders()).not.toContain('Loading older messages');
    expect(button('Load older messages')).toBeTruthy();
    conv.loading = false;
    button('Load older messages').click();
    expect(loadOlder).toHaveBeenCalledWith('c1');
    await d.tick(2);
    list.destroy();
  });
});

describe('a Join pressed in the preview bar while the bar is redrawn under it', () => {
  it('is not sent again from the fresh button, which is drawn busy, keeps the keyboard, and is freed with the answer', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.me.channels = ['c2']; // previewing #general
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [1, 2, 3].map(message) });
    store.act.c.c1 = { s: 3 };
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    const join = () => [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Join #general');
    let refuse = null;
    const joinChannel = vi.spyOn(store, 'joinChannel').mockImplementation(() => new Promise((_, reject) => { refuse = reject; }));
    const pressed = join();
    pressed.focus();
    pressed.click();
    expect(joinChannel).toHaveBeenCalledTimes(1);
    // The poll brings a change to the channel while the join is out: the bar is redrawn.
    store.ws.channels.c1.postPolicy = 'admins';
    store.emit('workspace');
    await d.tick(2);
    const fresh = join();
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(pressed);
    expect(fresh.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(fresh);
    fresh.click();
    expect(joinChannel).toHaveBeenCalledTimes(1);
    // Refused: the fresh button is live again, and the keyboard is still on it.
    refuse(new Error('You are offline'));
    await d.tick(5);
    expect(join().getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(join());
    join().click();
    expect(joinChannel).toHaveBeenCalledTimes(2);
    view.destroy();
  });
});

describe('the huddle window\'s room for the notch, in the stylesheet', () => {
  // Read the way the shell's safe-area tests read app.css: comments off, the
  // rules of each block of one media query flattened to (selector, declarations).
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocksOf = (media) => {
    const out = [];
    for (let at = css.indexOf(media); at >= 0; at = css.indexOf(media, at + 1)) {
      let depth = 0;
      let end = css.indexOf('{', at);
      for (; end < css.length; end++) {
        if (css[end] === '{') depth++;
        else if (css[end] === '}' && --depth === 0) break;
      }
      const inner = css.slice(css.indexOf('{', at) + 1, end);
      out.push([...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') })));
    }
    return out;
  };
  const top = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));

  it('is kept at both edges on a phone, since a window fixed to the screen takes no padding from the shell', () => {
    const phone = blocksOf('@media (max-width: 719px)').find((rules) => rules.some((r) => r.sel.startsWith('.huddle-dock')));
    const dock = phone.find((r) => r.sel === '.huddle-dock, .huddle-dock.expanded')?.body || '';
    expect(dock).toContain('left: calc(8px + var(--safe-l))');
    expect(dock).toContain('right: calc(8px + var(--safe-r))');
    expect(dock).toContain('width: auto');
    // And at the bottom, everywhere, as before.
    expect(top.find((r) => r.sel === '.huddle-dock')?.body).toContain('bottom: calc(8px + var(--safe-b))');
  });
});

describe('the import dialog\'s button', () => {
  it('keeps the keyboard through the import and after a refusal', async () => {
    const { dom: d } = await boot();
    const { importWorkspaceDialog } = await import('../src/ui/dialogs.js');
    importWorkspaceDialog();
    const pick = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Choose messages.json'));
    const input = document.querySelector('input[type="file"]');
    pick.focus(); // Tab to the button, then Space: the picker opens
    expect(document.activeElement).toBe(pick);
    // A file that is not a Teamchat export is chosen.
    input.files = [{ text: async () => JSON.stringify({ header: { format: 'something-else' } }) }];
    input.dispatchEvent(new Event('change'));
    // Busy, not disabled: the keyboard stays on the button while the archive is read.
    expect(document.activeElement).toBe(pick);
    expect(pick.getAttribute('aria-busy')).toBe('true');
    expect(pick.textContent).toBe('Importing');
    await d.tick(5);
    expect(document.querySelector('[role="status"]').textContent).toBe('Stopped: That is not a Teamchat export');
    expect(pick.getAttribute('aria-busy')).toBeNull();
    expect(pick.disabled).toBe(false);
    expect(pick.textContent).toContain('Choose messages.json');
    expect(document.activeElement).toBe(pick);
  });
});

describe('leaving a workspace with shared channels', () => {
  it('carries the server\'s word to each host that the seats there have ended', async () => {
    const { dom: d, api } = await boot();
    const { workspaceSettingsDialog } = await import('../src/ui/dialogs.js');
    store.ws.owner = 'u2';
    // The store on main knows how to carry such words (see 34a2a2f); here it is stood in for.
    store.carryRevocations = vi.fn(async () => {});
    vi.spyOn(store, 'leaveHosts').mockResolvedValue(undefined);
    vi.spyOn(store, 'closeWorkspace').mockImplementation(() => {});
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    const revocations = [{ ref: 'aaaaaaaaaa@host-test', conn: 'cn1', token: 'tok' }];
    const remove = vi.spyOn(api, 'removeMember').mockResolvedValue({ ok: true, revocations });
    workspaceSettingsDialog();
    const leave = [...document.querySelectorAll('.details-row')].find((r) => r.textContent.includes('Leave workspace'));
    expect(leave).toBeTruthy();
    leave.click();
    await d.tick(5);
    expect(store.leaveHosts).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(REF, 'u-me');
    expect(store.carryRevocations).toHaveBeenCalledWith(revocations);
  });
});

describe('taking over a workspace, done', () => {
  const complete = async (integrations) => {
    const { dom: d } = await boot();
    const { acceptTransferDialog } = await import('../src/ui/dialogs.js');
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    toast.mockClear();
    store.ws.owner = 'u2';
    store.ws.transferTo = 'u-me';
    if (integrations) store.ws.integrations = integrations;
    vi.spyOn(store, 'ensureOwnWorker').mockResolvedValue({ url: 'https://mine.test' });
    vi.spyOn(store, 'profileSeed').mockReturnValue({});
    vi.spyOn(store, '_addWorkspace').mockResolvedValue(undefined);
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    archive.transferWorkspace.mockResolvedValue({ ref: 'new@mine', mine: true, icon: null });
    acceptTransferDialog();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept and move it here').click();
    await d.tick(5);
    return toast.mock.calls.map(([t]) => t).find((t) => /now yours/.test(t));
  };

  it('says how many webhooks and bot tokens must be made again, only when there were any', async () => {
    expect(await complete(0)).not.toMatch(/token|webhook/i);
    const said = await complete(2);
    expect(said).toMatch(/2 webhooks or bot tokens/);
    expect(said).toMatch(/did not move/);
    expect(said).toMatch(/Workspace settings on the new server/);
    expect(await complete(1)).toMatch(/one webhook or bot token, and it did not move/);
  });
});

describe('taking over a workspace, opened again after the move stopped', () => {
  it('says where it stopped and that trying again carries on from there', async () => {
    const { dom: d } = await boot();
    const { acceptTransferDialog } = await import('../src/ui/dialogs.js');
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    toast.mockClear(); // the mocked modules outlive the module registry's reset
    store.ws.owner = 'u2';
    store.ws.transferTo = 'u-me';
    vi.spyOn(store, 'ensureOwnWorker').mockResolvedValue({ url: 'https://mine.test' });
    vi.spyOn(store, 'profileSeed').mockReturnValue({});
    let stop = null;
    archive.transferWorkspace.mockImplementation(() => new Promise((_, reject) => { stop = reject; }));
    const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
    const status = () => document.querySelector('[role="status"]');
    acceptTransferDialog();
    button('Accept and move it here').click();
    await d.tick(2);
    // Closed while it runs; the move stops with the dialog closed, and a toast says so.
    button('Close').click();
    stop(new Error('The server did not answer'));
    await d.tick(5);
    expect(toast.mock.calls.some(([t]) => /stopped: The server did not answer/.test(t))).toBe(true);
    // Opened again from the banner's Review: where it stopped, and the way on, are there to read.
    acceptTransferDialog();
    expect(status().textContent).toMatch(/Stopped: The server did not answer/);
    expect(status().textContent).toMatch(/carries on from here/);
    const start = button('Accept and move it here');
    expect(start).toBeTruthy();
    expect(start.getAttribute('aria-busy')).toBeNull();
  });
});

describe('the conversation column when the channel goes from under the keyboard', () => {
  it('lands the keyboard on the page that takes the messages\' place, not on the page body', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [1, 2, 3].map(message) });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3 };
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    const textarea = view.el.querySelector('textarea');
    textarea.focus();
    textarea.value = 'half a message';
    textarea.dispatchEvent(new Event('input'));
    // An admin deletes the channel: the next poll brings a workspace without it.
    delete store.ws.channels.c1;
    store.me.channels = ['c2'];
    store.emit('workspace');
    await d.tick(5);
    expect(view.el.querySelector('textarea')).toBeNull();
    const back = [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Back to channels');
    expect(back).toBeTruthy();
    expect(document.activeElement).toBe(back);
    view.destroy();
  });
});

describe('a guest leaving a private channel they are the last one in', () => {
  it('is asked, told an admin will have to add them back, and let go', async () => {
    await boot();
    const { leaveChannelFlow } = await import('../src/ui/dialogs.js');
    const { confirmDialog } = await import('../src/ui/modal.js');
    const { toast } = await import('../src/ui/toast.js');
    toast.mockClear();
    confirmDialog.mockClear();
    store.me.role = 'guest';
    store.ws.members['u-me'].role = 'guest';
    store.ws.channels.c3 = { id: 'c3', name: 'vendors', private: true, count: 1, members: ['u-me'] };
    store.me.channels = ['c3', 'c2'];
    const leave = vi.spyOn(store, 'leaveChannel').mockResolvedValue({});
    expect(await leaveChannelFlow(store.ws.channels.c3)).toBe(true);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(confirmDialog.mock.calls[0][0].message).toBe('An admin will have to add you back.');
    expect(leave).toHaveBeenCalledWith('c3');
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/last person/), expect.anything());
    // A member in the same place is still turned back before the question: the worker refuses them.
    store.me.role = 'member';
    store.ws.members['u-me'].role = 'member';
    expect(await leaveChannelFlow(store.ws.channels.c3)).toBe(false);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/last person in #vendors/), { icon: 'alert' });
  });
});

describe('leaving a channel, offered to a guest', () => {
  const asGuest = async (channels) => {
    const { dom: d } = await boot();
    store.me.role = 'guest';
    store.ws.members['u-me'].role = 'guest';
    store.me.channels = channels;
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'loadPins').mockResolvedValue([]);
    Object.assign(store.conv('c2'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    store.act.c.c2 = { s: 1 };
    return d;
  };
  const menuLabels = () => [...document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent.trim());

  it('is not offered in the header menu or the details for the only channel they are in, and is otherwise', async () => {
    const d = await asGuest(['c2']);
    const { createConversationView } = await import('../src/ui/conversation.js');
    const { openDetailsDialog } = await import('../src/ui/details.js');
    const { closeMenu } = await import('../src/ui/menu.js');
    const view = createConversationView('c2', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelector('.conv-header [aria-label="More"]').click();
    expect(menuLabels()).toContain('Copy name');
    expect(menuLabels()).not.toContain('Leave channel');
    closeMenu();
    let dialog = openDetailsDialog('c2');
    const leaveRow = () => [...document.querySelectorAll('.details-row')].find((r) => r.textContent.includes('Leave channel'));
    expect(leaveRow()).toBeUndefined();
    dialog.close();
    // Added to another channel: the door is offered again, worded for a guest.
    store.me.channels = ['c2', 'c1'];
    store.emit('workspace');
    await d.tick(2);
    view.el.querySelector('.conv-header [aria-label="More"]').click();
    expect(menuLabels()).toContain('Leave channel');
    closeMenu();
    dialog = openDetailsDialog('c2');
    expect(leaveRow()).toBeTruthy();
    expect(leaveRow().textContent).toContain('An admin will have to add you back');
    dialog.close();
    view.destroy();
  });
});

describe('the sidebar row\'s menu for a guest', () => {
  it('does not offer to leave the only channel they are in', async () => {
    await boot();
    const { rowMenuItems } = await import('../src/ui/notifymenu.js');
    store.me.role = 'guest';
    store.ws.members['u-me'].role = 'guest';
    store.me.channels = ['c2'];
    const labels = () => rowMenuItems('c2').filter((i) => i && i !== 'sep').map((i) => i.label);
    expect(labels()).toContain('Mute');
    expect(labels()).not.toContain('Leave channel');
    store.me.channels = ['c2', 'c1'];
    expect(labels()).toContain('Leave channel');
  });
});

describe('opening a direct message with someone', () => {
  it('leaves the reader where they went when the workspace changed while the server answered', async () => {
    const { dom: d } = await boot();
    const { openDmWith } = await import('../src/ui/dialogs.js');
    const { navigate } = await import('../src/lib/router.js');
    navigate.mockClear();
    let answer = null;
    vi.spyOn(store, 'openDmWith').mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const opening = openDmWith('u2');
    // Switched to another workspace meanwhile.
    store.wsId = 'ffffffffff@teamchat-test';
    answer({ ws: REF, conv: 'dm_u2' });
    await opening;
    await d.tick(1);
    expect(navigate).not.toHaveBeenCalled();
    // Staying put, the conversation opens as before, on the workspace the answer names (a host's, for someone met through a shared channel).
    store.wsId = REF;
    vi.spyOn(store, 'openDmWith').mockResolvedValue({ ws: 'host00000@teamchat-test', conv: 'dm_h' });
    await openDmWith('u3');
    expect(navigate).toHaveBeenCalledWith({ ws: 'host00000@teamchat-test', conv: 'dm_h' });
  });
});

describe('the pinned bar while the channel changes around it', () => {
  it('stays open, its list on show, when someone joins the channel', async () => {
    const { dom: d, api } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const msgs = [1, 2, 3].map((seq) => message(seq));
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: msgs });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3, pc: 2 };
    const pins = [1, 3].map((seq) => ({ seq, by: 'u2', ts: 1, message: msgs.find((m) => m.seq === seq) }));
    const read = vi.spyOn(api, 'pins').mockResolvedValue({ pins });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    const bar = () => view.el.querySelector('.pin-bar');
    bar().querySelector('.pin-bar-toggle').click();
    await d.tick(5);
    expect(bar().classList.contains('open')).toBe(true);
    expect(bar().querySelectorAll('.pin-row')).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
    // Someone joins the channel: the strips above the messages are redrawn for the new count.
    store.ws.channels.c1.count = 4;
    store.emit('workspace');
    await d.tick(5);
    expect(bar().classList.contains('open')).toBe(true);
    expect(bar().querySelectorAll('.pin-row')).toHaveLength(2);
    expect(bar().querySelector('.pin-bar-toggle').getAttribute('aria-expanded')).toBe('true');
    view.destroy();
  });
});

describe('a message being sent looks sent while it is quick about it', () => {
  const ctx = () => ({ convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });

  it('waits before it starts to look like it is still going, and not at all once it is', async () => {
    await boot();
    const { renderMessage, SENDING_DIM_MS } = await import('../src/ui/message.js');
    const just = { seq: null, tempId: 't1', user: 'u-me', text: 'hi', ts: Date.now(), kind: 'msg', attachments: [], mentions: [], reactions: {}, pending: true };
    const row = renderMessage(just, ctx());
    // Dimming is put off, so a send that lands in a few hundred milliseconds
    // never looks like anything but sent.
    const waited = Number(row.style.getPropertyValue('--sending-in').replace('ms', ''));
    expect(waited).toBeGreaterThan(SENDING_DIM_MS - 200);
    expect(waited).toBeLessThanOrEqual(SENDING_DIM_MS);
    expect(row.classList.contains('pending')).toBe(true);
  });

  it('counts the wait from when the message was written, so a redraw does not start it over', async () => {
    await boot();
    const { renderMessage, SENDING_DIM_MS } = await import('../src/ui/message.js');
    // Written well over the threshold ago and still going: it should look
    // like it, at once, however many times the list has been rebuilt since.
    const slow = { seq: null, tempId: 't2', user: 'u-me', text: 'hi', ts: Date.now() - (SENDING_DIM_MS + 4000), kind: 'msg', attachments: [], mentions: [], reactions: {}, pending: true };
    expect(renderMessage(slow, ctx()).style.getPropertyValue('--sending-in')).toBe('0ms');
  });

  it('says nothing of the sort once the message is really sent', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const sent = message(9, 'u-me');
    const row = renderMessage(sent, ctx());
    expect(row.classList.contains('pending')).toBe(false);
    expect(row.style.getPropertyValue('--sending-in')).toBe('');
  });

  it('leaves a queued message alone: its files may be a while, and it says so', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const queued = { seq: null, tempId: 't3', user: 'u-me', text: 'with a file', ts: Date.now(), kind: 'msg', attachments: [], mentions: [], reactions: {}, queued: true };
    const row = renderMessage(queued, ctx());
    expect(row.classList.contains('queued')).toBe(true);
    expect(row.classList.contains('pending')).toBe(false);
    // No waiting: an upload is genuinely slow and the row says so from the start.
    expect(row.style.getPropertyValue('--sending-in')).toBe('');
    expect(row.textContent).toMatch(/Queued/);
  });
});
