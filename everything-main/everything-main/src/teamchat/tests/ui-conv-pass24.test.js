/**
 * Conversation UI (review pass 24), driven in node through
 * tests/helpers/dom.js as the pass-19 to pass-23 files are: a fresh DOM and
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
vi.mock('../src/lib/archive.js', async (importOriginal) => ({ ...(await importOriginal()), exportWorkspace: vi.fn(), writeArchiveToDrive: vi.fn() }));

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

/** Polls until `cond()` holds (a debounced write, a timer), within a generous bound. */
async function waitFor(cond, ms = 5000) {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('waitFor: condition not met');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });
const key = (node, k, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(e);
  return e;
};

describe('a name picked from the mention list with the caret inside the handle being typed', () => {
  it('replaces the whole handle, not the part before the caret alone, and adds no second space where one follows', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const ta = composer.textarea;
    // The fake DOM keeps no selection and has no setRangeText: both stood in for here, as a browser has them.
    ta.setRangeText = function (text, start, end, mode) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      if (mode === 'end') this.selectionStart = this.selectionEnd = start + text.length;
    };
    ta.setSelectionRange = function (start, end) { this.selectionStart = start; this.selectionEnd = end; };
    const typed = (s, caret = s.length) => { ta.value = s; ta.selectionStart = ta.selectionEnd = caret; ta.dispatchEvent(new Event('input')); };
    // A typo in a handle being fixed: the caret sits after "@an", the rest of the handle and a word after it.
    typed('@anna rest', 3);
    const rows = () => [...composer.el.querySelectorAll('.mention-pop .pick-item')].map((n) => n.textContent);
    expect(rows().some((r) => r.includes('Ana Rocha'))).toBe(true);
    key(ta, 'Enter');
    expect(ta.value).toBe('@ana rest');
    expect(ta.selectionStart).toBe('@ana '.length);
    // At the end of the text the space is added as before.
    typed('hi @anna', 6);
    key(ta, 'Enter');
    expect(ta.value).toBe('hi @ana ');
    composer.destroy();
  });
});

describe('the huddle dock\'s controls for a screen reader', () => {
  it('say the state first and press as that state (a live microphone is not "Mute, pressed"), and hand the keyboard on when the huddle ends under it', async () => {
    const { dom: d } = await boot();
    const { mountHuddleDock } = await import('../src/ui/huddle.js');
    const h = { mic: true, cam: false, screen: false, state: 'live', peers: new Map(), visiblePeers: () => [], screenStream: null, camStream: null, micAvailable: true, speaking: false };
    store.huddle = h;
    store._huddleInfo = { ws: REF, conv: 'c1', at: Date.now() - 5000, title: 'general' }; // what the huddleInfo getter reads
    vi.spyOn(store, 'huddleMembers').mockReturnValue(['u-me', 'u2']);
    const dock = mountHuddleDock();
    await d.tick(1);
    const ctl = (name) => document.querySelector(`.huddle-ctl-${name}`);
    expect(ctl('mic').getAttribute('aria-pressed')).toBe('true');
    expect(ctl('mic').getAttribute('aria-label')).toBe('Microphone on. Mute');
    expect(ctl('cam').getAttribute('aria-pressed')).toBe('false');
    expect(ctl('cam').getAttribute('aria-label')).toBe('Camera off. Turn on');
    expect(ctl('share').getAttribute('aria-pressed')).toBe('false');
    expect(ctl('share').getAttribute('aria-label')).toBe('Share your screen');
    expect(ctl('leave').getAttribute('aria-pressed')).toBeNull();
    h.mic = false;
    h.cam = true;
    h.screen = true;
    store.emit('huddle-media');
    expect(ctl('mic').getAttribute('aria-pressed')).toBe('false');
    expect(ctl('mic').getAttribute('aria-label')).toBe('Microphone off. Unmute');
    expect(ctl('cam').getAttribute('aria-label')).toBe('Camera on. Turn off');
    expect(ctl('share').getAttribute('aria-pressed')).toBe('true');
    expect(ctl('share').getAttribute('aria-label')).toBe('Sharing your screen. Stop sharing');
    // The huddle ends (the last other person left, the call dropped) with the keyboard on the mute button: it goes to the message box, not the page body.
    const main = document.createElement('div');
    main.className = 'main';
    const box = document.createElement('textarea');
    main.append(box);
    document.body.append(main);
    ctl('mic').focus();
    expect(document.activeElement).toBe(ctl('mic'));
    store.huddle = null;
    store.emit('huddle');
    expect(document.activeElement).toBe(box);
    expect(document.querySelector('.huddle-dock').hidden).toBe(true);
    dock.destroy();
  });
});

describe('Remove pressed from the keyboard on a workspace icon or a profile photo', () => {
  it('hands the keyboard to "Add an icon" as the Remove button hides, rather than dropping it on the page body behind the dialog', async () => {
    const { dom: d } = await boot();
    const { workspaceSettingsDialog } = await import('../src/ui/dialogs.js');
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.icon = 'ico-1';
    vi.spyOn(store, 'updateWorkspaceIcon').mockResolvedValue(null);
    workspaceSettingsDialog();
    await d.tick(1);
    const remove = [...document.querySelectorAll('.ws-icon-row button')].find((b) => b.textContent.trim() === 'Remove');
    const add = [...document.querySelectorAll('.ws-icon-row button')].find((b) => /icon$/.test(b.textContent.trim()));
    expect(remove && add).toBeTruthy();
    remove.focus();
    remove.click();
    await d.tick(3);
    expect(store.updateWorkspaceIcon).toHaveBeenCalledWith(null);
    expect(remove.hidden).toBe(true);
    expect(add.textContent.trim()).toBe('Add an icon');
    expect(document.activeElement).toBe(add);
  });

  it('and to "Add a photo" in the profile settings', async () => {
    const { dom: d } = await boot();
    const { settingsDialog } = await import('../src/ui/dialogs.js');
    store.profile.avatar = 'av-1';
    vi.spyOn(store, 'updateAvatar').mockImplementation(async () => { store.profile.avatar = null; });
    vi.spyOn(store, 'statusOf').mockReturnValue(null);
    settingsDialog();
    await d.tick(1);
    const remove = [...document.querySelectorAll('.profile-card button')].find((b) => b.textContent.trim() === 'Remove');
    const add = [...document.querySelectorAll('.profile-card button')].find((b) => /photo$/.test(b.textContent.trim()));
    expect(remove && add).toBeTruthy();
    remove.focus();
    remove.click();
    await d.tick(3);
    expect(remove.hidden).toBe(true);
    expect(add.textContent.trim()).toBe('Add a photo');
    expect(document.activeElement).toBe(add);
  });
});

describe('the Export dialog opened again while an export runs', () => {
  it('shows the export still going and takes no second one, and a dialog opened once it is done starts afresh', async () => {
    const { dom: d } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    const { openModal } = await import('../src/ui/modal.js');
    let finish = null;
    // The mocked module outlives resetModules: its counts are this test's from here.
    archive.exportWorkspace.mockClear();
    archive.exportWorkspace.mockImplementation((ref, { onProgress }) => new Promise((r) => { onProgress({ phase: 'messages', done: 1, total: 3 }); finish = r; }));
    archive.writeArchiveToDrive.mockResolvedValue('Teamchat exports/Globex');
    const { exportDialog } = await import('../src/ui/dialogs.js');
    const open = () => { exportDialog(); return openModal.mock.calls.at(-1)[0].content; };
    const startOf = (c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Export now');
    const first = open();
    startOf(first).click();
    await d.tick(2);
    expect(archive.exportWorkspace).toHaveBeenCalledTimes(1);
    expect(first.querySelector('[role="status"]').textContent).toBe('Messages: 1 of 3 conversations');
    // Closed (the dialog says to keep the tab open, not the dialog), and opened again from Workspace settings while the export runs.
    [...first.querySelectorAll('button')].find((b) => b.textContent === 'Close').click();
    const second = open();
    expect(startOf(second).getAttribute('aria-busy')).toBe('true');
    expect(second.querySelector('[role="status"]').textContent).toBe('Messages: 1 of 3 conversations');
    startOf(second).click();
    expect(archive.exportWorkspace).toHaveBeenCalledTimes(1);
    // The export lands: the dialog showing it says so, once.
    finish({ header: {}, pages: [], files: [] });
    await d.tick(5);
    expect(second.querySelector('[role="status"]').textContent).toContain('Done. Saved to Teamchat exports/Globex');
    expect(startOf(second).getAttribute('aria-busy')).toBeNull();
    expect(startOf(second).disabled).toBe(true);
    expect(toast.mock.calls.filter((c) => c[0] === 'Workspace exported')).toHaveLength(1);
    // Done: a dialog opened later offers a fresh export, and says nothing of the last.
    [...second.querySelectorAll('button')].find((b) => b.textContent === 'Close').click();
    const third = open();
    expect(startOf(third).getAttribute('aria-busy')).toBeNull();
    expect(startOf(third).disabled).toBe(false);
    expect(third.querySelector('[role="status"]').textContent).toBe('');
  });

  it('says where a stopped export got to when opened again, and lets it be tried again', async () => {
    const { dom: d } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    const { openModal } = await import('../src/ui/modal.js');
    let fail = null;
    archive.exportWorkspace.mockClear();
    archive.exportWorkspace.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const { exportDialog } = await import('../src/ui/dialogs.js');
    const open = () => { exportDialog(); return openModal.mock.calls.at(-1)[0].content; };
    const startOf = (c) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Export now');
    const first = open();
    startOf(first).click();
    await d.tick(2);
    [...first.querySelectorAll('button')].find((b) => b.textContent === 'Close').click();
    // Stopped while no dialog shows it: said where the reader is.
    fail(new Error('The drive is full'));
    await d.tick(3);
    expect(toast).toHaveBeenCalledWith('Export stopped: The drive is full', expect.objectContaining({ icon: 'alert' }));
    const second = open();
    expect(second.querySelector('[role="status"]').textContent).toContain('Stopped: The drive is full');
    expect(startOf(second).getAttribute('aria-busy')).toBeNull();
    startOf(second).click();
    expect(archive.exportWorkspace).toHaveBeenCalledTimes(2);
  });
});

describe('the Guests dialog while another admin changes the guests', () => {
  it('redraws its list from the server when the workspace\'s guests change, rather than offering "Make member" for someone who is one already', async () => {
    const { dom: d } = await boot();
    const { guestsDialog } = await import('../src/ui/dialogs.js');
    store.me.role = 'admin';
    store.ws.members['u-me'].role = 'admin';
    store.ws.members.u4 = { role: 'guest', name: 'Gia Guest', username: 'gia', color: 4 };
    let guests = [{ uuid: 'u4', channels: ['c1'], hidden: 0 }];
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/guests')) return json({ guests });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    guestsDialog();
    await d.tick(5);
    const names = () => [...document.querySelectorAll('.pick-item strong')].map((n) => n.textContent);
    expect(names()).toEqual(['Gia Guest']);
    // Another admin makes Gia a full member: the poll brings the role, and the server lists no guests.
    store.ws.members.u4.role = 'member';
    guests = [];
    store.emit('workspace');
    await d.tick(5);
    expect(names()).toEqual([]);
    expect(document.querySelector('.pick-list .empty')).toBeTruthy();
    // An unrelated change (a topic) does not read the list again.
    const before = globalThis.puter.workers.exec;
    const calls = [];
    globalThis.puter.workers.exec = async (...a) => { calls.push(a[0]); return before(...a); };
    store.ws.channels.c1.topic = 'new';
    store.emit('workspace');
    await d.tick(3);
    expect(calls).toEqual([]);
  });
});

describe('the emoji picker\'s category strip while the grid scrolls under a tab the keyboard is on', () => {
  it('keeps the focused tab as the strip\'s one stop, so Shift+Tab leaves the strip for the tone button rather than landing on a sibling tab, and hands the stop back to the selected tab once the keyboard leaves', async () => {
    const { dom: d } = await boot();
    const { openEmojiPicker } = await import('../src/ui/emojipicker.js');
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const pop = openEmojiPicker(anchor, { onPick: vi.fn() });
    await d.tick(1);
    const tabs = () => [...document.querySelectorAll('.emoji-tab')];
    const stops = () => tabs().filter((t) => t.getAttribute('tabindex') === '0');
    tabs()[0].focus();
    d.key(document.activeElement, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[1]);
    // The grid scrolls (the arrow's own scroll landing, a wheel): the section in view is another tab's (here the last, every box being zero-sized).
    document.querySelector('.emoji-body').dispatchEvent(new Event('scroll'));
    const last = tabs()[tabs().length - 1];
    expect(last.getAttribute('aria-selected')).toBe('true');
    // The highlight follows the scroll; the stop stays with the keyboard.
    expect(stops()).toEqual([tabs()[1]]);
    d.key(document.activeElement, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(document.querySelector('.emoji-tone'));
    // The keyboard gone from the strip, the selected tab is the stop again.
    expect(stops()).toEqual([last]);
    pop.close();
  });
});

describe('"Also send to #channel" ticked under a thread\'s reply box, and the reply scheduled with Send later', () => {
  /** A thread panel on message 2 of #general with the root in the window, the store's send and schedule held as spies. */
  async function openThread() {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const schedule = vi.spyOn(store, 'schedule').mockImplementation(async (conv, entry) => ({ id: `s-${conv}`, ...entry }));
    const send = vi.spyOn(store, 'send').mockImplementation(async () => ({ seq: 9 }));
    const root = { ...message(2), replyCount: 1 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), root] });
    Object.assign(store.conv('c1_t2'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u3')] });
    store.act.c.c1 = { s: 2 };
    const panel = document.createElement('section');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 2, onClose() {} });
    await d.tick(3);
    const also = panel.querySelector('.also-send input');
    expect(also).toBeTruthy();
    return { d, panel, thread, also, schedule, send };
  }
  const later = async (d, panel) => {
    panel.querySelector('.send-later').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.getAttribute('role') === 'menuitem' && !b.textContent.includes('Custom')).click();
    await d.tick(3);
  };

  it('schedules the copy for the channel too, pointing back at the thread as a sent copy does, and unticks the box', async () => {
    const { d, panel, thread, also, schedule, send } = await openThread();
    also.checked = true;
    d.type(panel.querySelector('.composer textarea'), 'later, both');
    await later(d, panel);
    expect(send).not.toHaveBeenCalled();
    expect(schedule.mock.calls.map((c) => c[0])).toEqual(['c1_t2', 'c1']);
    expect(schedule.mock.calls[0][1].text).toBe('later, both');
    expect(schedule.mock.calls[1][1].text).toMatch(/^later, both\n\n> Also sent from https?:\/\/.+#\/ws\/.*\/c1\/t\/2$/);
    expect(schedule.mock.calls[1][1].dueAt).toBe(schedule.mock.calls[0][1].dueAt);
    expect(panel.querySelector('.also-send input').checked).toBe(false);
    expect(panel.querySelector('.composer textarea').value).toBe('');
    thread.destroy();
  });

  it('schedules the reply alone when the box is not ticked', async () => {
    const { d, panel, thread, schedule } = await openThread();
    d.type(panel.querySelector('.composer textarea'), 'later, thread only');
    await later(d, panel);
    expect(schedule.mock.calls.map((c) => c[0])).toEqual(['c1_t2']);
    thread.destroy();
  });
});

describe('acting on the root of a thread opened from a link, while the channel\'s window does not reach it', () => {
  /** A thread panel on message 5 of #general, the window holding 44 and 45 alone, the root fetched on its own; the worker takes every write. */
  async function panelOnFetchedRoot(rootExtra = {}) {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.pokeSync = () => {};
    const root = { ...message(5, 'u-me'), text: 'root 5', replyCount: 1, ...rootExtra };
    const calls = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      const path = u.pathname;
      if (path.endsWith('/messages') && u.searchParams.get('from') === '5') return json({ messages: [root], seq: 45 });
      if (path.endsWith('/messages')) return json({ messages: [], seq: 0 });
      calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'PUT' && path.endsWith('/messages/5')) return json({ text: JSON.parse(init.body).text, editedAt: 1_700_000_009_000 });
      if (init.method === 'DELETE' && path.endsWith('/messages/5')) return json({ ok: true });
      if (init.method === 'DELETE' && path.endsWith('/messages/5/unfurl')) return json({ ok: true });
      if (init.method === 'POST' && path.endsWith('/pins')) return json({ ok: true });
      if (init.method === 'DELETE' && path.endsWith('/pins/5')) return json({ ok: true });
      if (init.method === 'PUT' && path.endsWith('/notify')) return json({ ok: true });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    Object.assign(store.conv('c1'), { loaded: true, seq: 45, hasMore: true, messages: [message(44), message(45)] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 1, hasMore: false, messages: [{ ...message(1, 'u3'), text: 'r1' }] });
    store.act.c.c1 = { s: 45, pc: 0 };
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(10);
    const rootRow = () => panel.querySelector('.msg.thread-root');
    expect(rootRow()).toBeTruthy();
    expect(store.conv('c1').messages.find((m) => m.seq === 5)).toBeUndefined();
    return { d, panel, thread, rootRow, calls };
  }

  it('an edit saved from the panel shows on its root row, as the worker has it, rather than the old words until the thread is opened again', async () => {
    const { d, panel, thread, rootRow, calls } = await panelOnFetchedRoot();
    const { startInlineEdit } = await import('../src/ui/message.js');
    expect(startInlineEdit(rootRow())).toBe(true);
    const input = rootRow().querySelector('.msg-edit-input');
    d.type(input, 'root 5, put right');
    key(input, 'Enter');
    await d.tick(5);
    expect(calls.map((c) => `${c.method} ${c.path.split('/').slice(-2).join('/')}`)).toEqual(['PUT messages/5']);
    expect(panel.querySelector('.msg-edit-input')).toBeNull();
    expect(rootRow().querySelector('.msg-text').textContent).toContain('root 5, put right');
    expect(rootRow().querySelector('.msg-edited')).toBeTruthy();
    thread.destroy();
  });

  it('a deletion from the panel closes the thread (the reply box gives way to the note), rather than leaving a box whose every reply the worker would refuse', async () => {
    const { d, panel, thread, rootRow } = await panelOnFetchedRoot();
    const { toast } = await import('../src/ui/toast.js');
    expect(panel.querySelector('.composer')).toBeTruthy();
    rootRow().focus();
    key(rootRow(), 'Delete');
    await d.tick(5);
    expect(toast).toHaveBeenCalledWith('Message deleted', expect.anything());
    expect(panel.querySelector('.composer')).toBeNull();
    expect(rootRow().classList.contains('deleted')).toBe(true);
    expect(rootRow().querySelector('.msg-text').textContent).toBe('This message was deleted');
    thread.destroy();
  });

  it('a pin from the panel marks the root row as pinned, and the next press offers to unpin it', async () => {
    const { d, thread, rootRow, calls } = await panelOnFetchedRoot();
    rootRow().focus();
    key(rootRow(), 'p');
    await d.tick(5);
    expect(calls.map((c) => c.method)).toEqual(['POST']);
    expect(rootRow().querySelector('.msg-pinned')).toBeTruthy();
    expect(rootRow().classList.contains('pinned')).toBe(true);
    rootRow().focus();
    key(rootRow(), 'p');
    await d.tick(5);
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    expect(calls[1].path.endsWith('/pins/5')).toBe(true);
    expect(rootRow().querySelector('.msg-pinned')).toBeNull();
    thread.destroy();
  });

  it('the "N replies" line under the root follows the replies that land in the thread, rather than standing at the count the root was fetched with', async () => {
    const { d, panel, thread } = await panelOnFetchedRoot({ replyCount: 1 });
    const count = () => panel.querySelector('.thread-count')?.textContent;
    expect(count()).toBe('1 reply');
    // A reply lands (the reader's own, or a teammate's brought by the poll): the thread's list grows.
    const t = store.conv('c1_t5');
    const reply = { ...message(2, 'u-me'), text: 'r2' };
    t.messages.push(reply);
    t.seq = 2;
    store.emit('messages', { conv: 'c1_t5', reason: 'newer', added: [reply] });
    await d.tick(3);
    expect([...panel.querySelectorAll('.msg:not(.thread-root)')]).toHaveLength(2);
    expect(count()).toBe('2 replies');
    thread.destroy();
  });

  it('the follow bell reads the reader\'s standing from the fetched root: its author follows by default, and one press unfollows', async () => {
    const { d, panel, thread, calls } = await panelOnFetchedRoot({ followers: null });
    const bell = () => panel.querySelector('.panel-head [aria-pressed]');
    expect(bell().getAttribute('aria-pressed')).toBe('true');
    expect(bell().getAttribute('aria-label')).toBe('Following this thread. Unfollow');
    bell().click();
    await d.tick(5);
    expect(calls.map((c) => `${c.method} ${c.path.split('/').pop()} ${JSON.stringify(c.body)}`)).toEqual(['PUT notify {"follow":false}']);
    expect(bell().getAttribute('aria-pressed')).toBe('false');
    expect(bell().getAttribute('aria-label')).toBe('Follow this thread');
    thread.destroy();
  });

  it('and a replier who follows by the worker\'s record is shown following; a reader who never replied is not', async () => {
    const a = await panelOnFetchedRoot({ user: 'u2', followers: { 'u-me': 1 } });
    expect(a.panel.querySelector('.panel-head [aria-pressed]').getAttribute('aria-pressed')).toBe('true');
    a.thread.destroy();
    const b = await panelOnFetchedRoot({ user: 'u2', followers: null });
    expect(b.panel.querySelector('.panel-head [aria-pressed]').getAttribute('aria-pressed')).toBe('false');
    b.thread.destroy();
  });

  it('a link preview removed from the panel goes from the root row', async () => {
    const { d, thread, rootRow, calls } = await panelOnFetchedRoot({ unfurl: { kind: 'link', url: 'https://example.com/a', site: 'example.com', title: 'An example' } });
    expect(rootRow().querySelector('.unfurl')).toBeTruthy();
    rootRow().querySelector('.unfurl-remove').click();
    await d.tick(5);
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
    expect(rootRow().querySelector('.unfurl')).toBeNull();
    thread.destroy();
  });
});

describe('a message scheduled with Send later while the conversation was being left, the reader typing into the box opened next', () => {
  /** A box on #general whose Send later request is held until answered here, then a second box opened on the same conversation. */
  async function scheduling() {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    let answer = null;
    const onSendLater = vi.fn(() => new Promise((r) => { answer = r; }));
    const key = `${REF}:c1`;
    const open = () => {
      const box = createComposer({ onSend: vi.fn(), onSendLater, convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const a = open();
    d.type(a.textarea, 'later');
    a.el.querySelector('.send-later').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.getAttribute('role') === 'menuitem' && !b.textContent.includes('Custom')).click();
    await d.tick(2);
    expect(onSendLater).toHaveBeenCalledTimes(1);
    a.destroy();
    a.el.remove();
    expect(getDraft(key)).toMatchObject({ text: 'later' });
    const b = open();
    expect(b.textarea.value).toBe('later');
    return { d, b, answer: () => answer({}), getDraft, key, open };
  }

  it('keeps the words typed there, in the box and in the draft, when the box had saved them before the worker answered', async () => {
    const { d, b, answer, getDraft, key, open } = await scheduling();
    d.type(b.textarea, 'later, and something else');
    // The box writes its draft once typing pauses: the words are saved before the schedule lands.
    await waitFor(() => getDraft(key)?.text === 'later, and something else');
    answer();
    await d.tick(3);
    expect(b.textarea.value).toBe('later, and something else');
    // The draft under the box is still the box's words, not emptied by the box that had gone.
    expect(getDraft(key)).toMatchObject({ text: 'later, and something else' });
    // Left and come back to: the words are there.
    b.destroy();
    b.el.remove();
    expect(getDraft(key)).toMatchObject({ text: 'later, and something else' });
    const c = open();
    expect(c.textarea.value).toBe('later, and something else');
    c.destroy();
  });

  it('still empties the box opened next when nothing was typed there, and the draft with it', async () => {
    const { d, b, answer, getDraft, key } = await scheduling();
    answer();
    await d.tick(3);
    expect(b.textarea.value).toBe('');
    expect(getDraft(key)).toBeNull();
    b.destroy();
  });

  it('clears the draft when no box is open on the conversation as the schedule lands, and leaves one another box has since changed', async () => {
    const { d, b, answer, getDraft, key, open } = await scheduling();
    // Left again before the worker answers: no box open, the draft holds the scheduled words.
    b.destroy();
    b.el.remove();
    expect(getDraft(key)).toMatchObject({ text: 'later' });
    answer();
    await d.tick(3);
    expect(getDraft(key)).toBeNull();
    const c = open();
    expect(c.textarea.value).toBe('');
    c.destroy();
  });
});
