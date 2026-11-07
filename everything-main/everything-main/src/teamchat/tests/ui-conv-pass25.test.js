/**
 * Conversation UI (review pass 25), driven in node through
 * tests/helpers/dom.js as the pass-19 to pass-24 files are: a fresh DOM and
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

/** A composer in the DOM whose textarea keeps a selection and has setRangeText, as a browser's does (the fake DOM has neither). */
async function composerBox() {
  const { createComposer } = await import('../src/ui/composer.js');
  const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
  document.body.append(composer.el);
  const ta = composer.textarea;
  ta.setRangeText = function (text, start, end, mode) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    if (mode === 'end') this.selectionStart = this.selectionEnd = start + text.length;
  };
  ta.setSelectionRange = function (start, end) { this.selectionStart = start; this.selectionEnd = end; };
  const typed = (s, caret = s.length) => { ta.value = s; ta.selectionStart = ta.selectionEnd = caret; ta.dispatchEvent(new Event('input')); };
  return { composer, ta, typed };
}

describe('a name picked from the mention list at the end of a line, with another line under it', () => {
  it('keeps the caret on the line the handle was typed on, after a space, rather than moving it to the start of the next line', async () => {
    await boot();
    const { composer, ta, typed } = await composerBox();
    // "@an" typed at the end of the first line of a two-line message, the caret after it.
    typed('@an\nsecond line', 3);
    expect([...composer.el.querySelectorAll('.mention-pop .pick-item')].some((n) => n.textContent.includes('Ana Rocha'))).toBe(true);
    key(ta, 'Enter');
    // The words typed next go after the name on its own line, as they do at the end of the text.
    expect(ta.value).toBe('@ana \nsecond line');
    expect(ta.selectionStart).toBe('@ana '.length);
    // A space already there is used, and the caret goes past it (pass 24).
    typed('@an rest', 3);
    key(ta, 'Enter');
    expect(ta.value).toBe('@ana rest');
    expect(ta.selectionStart).toBe('@ana '.length);
    composer.destroy();
  });

  it('the same for an emoji picked from its list at the end of a line', async () => {
    await boot();
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    const { composer, ta, typed } = await composerBox();
    typed(':smile\nsecond line', 6);
    await dom.tick(2);
    expect(composer.el.querySelector('.mention-pop .pick-item')).toBeTruthy();
    key(ta, 'Enter');
    expect(ta.value).toMatch(/^\S+ \nsecond line$/);
    expect(ta.selectionStart).toBe(ta.value.indexOf('\n'));
    composer.destroy();
  });
});

describe('a message sent while its @channel question stands, the box rebuilt under the question', () => {
  /** A composer on #general whose beforeSend holds until `answer` is called, and the store's send held as a spy. */
  async function askedBox() {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const { getDraft } = await import('../src/lib/drafts.js');
    let answer = null;
    const beforeSend = vi.fn(() => new Promise((r) => { answer = r; }));
    const onSend = vi.fn(async () => ({ seq: 9 }));
    const make = () => {
      const c = createComposer({ onSend, beforeSend, convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
      document.body.append(c.el);
      return c;
    };
    const first = make();
    d.type(first.textarea, 'hello @channel');
    key(first.textarea, 'Enter');
    await d.tick(1);
    expect(beforeSend).toHaveBeenCalledTimes(1);
    return { d, first, make, answer: () => answer(true), onSend, draft: () => getDraft(`${REF}:c1`) };
  }

  it('is let go of by the box now open, which had taken the words up from the draft as an unsent message', async () => {
    const { d, first, make, answer, onSend, draft } = await askedBox();
    // The foot is rebuilt while the question stands (a rule of the channel changed under it): the box that goes leaves its words in the draft, and the next takes them up.
    first.destroy();
    const second = make();
    expect(second.textarea.value).toBe('hello @channel');
    answer();
    await d.tick(3);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('hello @channel');
    // Sent: the words go from the box now open and from the draft, rather than standing there as a message still to send.
    expect(second.textarea.value).toBe('');
    expect(draft()).toBeNull();
    second.destroy();
  });

  it('but leaves words typed on in the box now open, which are the reader\'s', async () => {
    const { d, first, make, answer, draft } = await askedBox();
    first.destroy();
    const second = make();
    d.type(second.textarea, 'hello @channel, and more');
    answer();
    await d.tick(3);
    expect(second.textarea.value).toBe('hello @channel, and more');
    await waitFor(() => draft()?.text === 'hello @channel, and more');
    second.destroy();
  });
});

describe('the keyboard after Send is pressed with the pointer', () => {
  it('is back in the box the moment the message goes, not after the worker has answered: the button goes disabled with the box emptied, and the keyboard on it fell to the page for the length of the send', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    let land = null;
    const onSend = vi.fn(() => new Promise((r) => { land = r; }));
    const composer = createComposer({ onSend, convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    d.type(composer.textarea, 'off it goes');
    const send = composer.el.querySelector('.send-btn');
    expect(send.disabled).toBe(false);
    // A click focuses the button (Chrome, Firefox) before its click lands.
    send.focus();
    expect(document.activeElement).toBe(send);
    send.click();
    await d.tick(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(composer.textarea.value).toBe('');
    expect(send.disabled).toBe(true);
    // The request is still out; the next words typed must land in the box.
    expect(document.activeElement).toBe(composer.textarea);
    land({ seq: 9 });
    await d.tick(2);
    expect(document.activeElement).toBe(composer.textarea);
    composer.destroy();
  });

  it('a press of the pointer on Send leaves the keyboard in the box to begin with, as the formatting buttons do', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const composer = createComposer({ onSend: vi.fn(async () => ({ seq: 9 })), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const send = composer.el.querySelector('.send-btn');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    send.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    composer.destroy();
  });
});

describe('the Search index dialog opened again while a build runs', () => {
  /** An admin's workspace whose reindex requests hang until `answer` resolves them; the dialog opened afresh by `open()`. */
  async function building() {
    const { dom: d } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue(undefined);
    const { toast } = await import('../src/ui/toast.js');
    const { openModal } = await import('../src/ui/modal.js');
    const pending = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (url.includes('/search/reindex')) return new Promise((r) => { pending.push(r); });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const { searchIndexDialog } = await import('../src/ui/dialogs.js');
    const open = () => { searchIndexDialog(); return openModal.mock.calls.at(-1)[0].content; };
    const startOf = (c) => [...c.querySelectorAll('button')].find((b) => /index|Try again/.test(b.textContent));
    const closeOf = (c) => [...c.querySelectorAll('button')].find((b) => /^(Close|Done|Not now)$/.test(b.textContent));
    return { d, toast, open, startOf, closeOf, pending, answer: (body) => pending.shift()(json(body)) };
  }

  it('shows the build still going and takes no second one, and a dialog opened once it is done starts afresh', async () => {
    const { d, toast, open, startOf, closeOf, pending, answer } = await building();
    const first = open();
    startOf(first).click();
    await d.tick(2);
    expect(pending).toHaveLength(1);
    answer({ done: false, state: { i: 1 }, progress: { done: 1, total: 3, messages: 40 } });
    await d.tick(3);
    expect(pending).toHaveLength(1);
    expect(first.querySelector('[role="status"]').textContent).toBe('Indexed 40 messages across 1 of 3 conversations');
    // Closed (the dialog says to keep the tab open, not the dialog) and opened again from Workspace settings while the build runs.
    closeOf(first).click();
    const second = open();
    expect(startOf(second).getAttribute('aria-busy')).toBe('true');
    expect(second.querySelector('[role="status"]').textContent).toBe('Indexed 40 messages across 1 of 3 conversations');
    expect(second.querySelector('[role="progressbar"]').hidden).toBe(false);
    startOf(second).click();
    await d.tick(2);
    // No second walk of the workspace beside the first.
    expect(pending).toHaveLength(1);
    // The build lands: the dialog showing it says so, once.
    answer({ done: true, progress: { done: 3, total: 3, messages: 120 } });
    await d.tick(5);
    expect(second.querySelector('[role="status"]').textContent).toBe('Done. Every message in this workspace can now be found.');
    expect(startOf(second).getAttribute('aria-busy')).toBeNull();
    expect(startOf(second).disabled).toBe(true);
    expect(toast.mock.calls.filter((c) => c[0] === 'Search index built')).toHaveLength(1);
    // Done: a dialog opened later offers a fresh build, and says nothing of the last.
    closeOf(second).click();
    const third = open();
    expect(startOf(third).getAttribute('aria-busy')).toBeNull();
    expect(startOf(third).disabled).toBe(false);
    expect(third.querySelector('[role="status"]').textContent).toBe('');
  });

  it('says where a stopped build got to when opened again, and carries on from there', async () => {
    const { d, toast, open, startOf, closeOf, pending } = await building();
    const first = open();
    startOf(first).click();
    await d.tick(2);
    pending.shift()(json({ done: false, state: { i: 2 }, progress: { done: 2, total: 5, messages: 80 } }));
    await d.tick(3);
    closeOf(first).click();
    // Stopped while no dialog shows it: said where the reader is.
    pending.shift()(json({ code: 'error', message: 'boom' }, 500));
    await d.tick(5);
    expect(toast.mock.calls.some((c) => /Search index stopped: boom/.test(c[0]))).toBe(true);
    const second = open();
    expect(second.querySelector('[role="status"]').textContent).toMatch(/^Stopped: boom\. Try again to carry on from where it stopped/);
    expect(startOf(second).textContent).toBe('Try again');
    expect(startOf(second).getAttribute('aria-busy')).toBeNull();
    // Tried again from here: the next request carries the state the last step handed back.
    let sent = null;
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (url.includes('/search/reindex')) { sent = JSON.parse(init.body); return new Promise(() => {}); }
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    startOf(second).click();
    await d.tick(2);
    expect(sent?.state).toEqual({ i: 2 });
    expect(startOf(second).getAttribute('aria-busy')).toBe('true');
  });
});

describe('the Import dialog closed while an import runs', () => {
  /** The dialog with a messages.json chosen, the import held at "Preparing your server" until `finish` or `fail` is called. */
  async function importing() {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const { openModal } = await import('../src/ui/modal.js');
    let settle = null;
    vi.spyOn(store, 'ensureOwnWorker').mockImplementation((report) => new Promise((resolve, reject) => { report('Preparing your server'); settle = { resolve, reject }; }));
    const { importWorkspaceDialog } = await import('../src/ui/dialogs.js');
    const open = () => { importWorkspaceDialog(); return openModal.mock.calls.at(-1)[0].content; };
    const pickOf = (c) => [...c.querySelectorAll('button')].find((b) => /messages\.json|Importing/.test(b.textContent));
    const cancelOf = (c) => [...c.querySelectorAll('button')].find((b) => /^(Cancel|Close)$/.test(b.textContent));
    const first = open();
    const input = first.querySelector('input[type="file"]');
    input.files = [{ name: 'messages.json', text: async () => JSON.stringify({ header: { format: 'teamchat-export', workspace: { name: 'Initech' } } }) }];
    input.dispatchEvent(new Event('change'));
    await d.tick(3);
    expect(pickOf(first).getAttribute('aria-busy')).toBe('true');
    expect(first.querySelector('[role="status"]').textContent).toBe('Preparing your server');
    return { d, toast, open, pickOf, cancelOf, first, fail: (e) => settle.reject(e) };
  }

  it('shows the import still going when opened again and takes no second file meanwhile', async () => {
    const { d, open, pickOf, cancelOf, first } = await importing();
    cancelOf(first).click();
    const second = open();
    expect(pickOf(second).getAttribute('aria-busy')).toBe('true');
    expect(second.querySelector('[role="status"]').textContent).toBe('Preparing your server');
    // The button takes no press while the import runs: no file picker opens for a second import beside the first.
    const opened = vi.fn();
    second.querySelector('input[type="file"]').addEventListener('click', opened);
    pickOf(second).click();
    await d.tick(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it('says in a toast that the import stopped when no dialog shows it, and the next one opened says where', async () => {
    const { d, toast, open, pickOf, cancelOf, first, fail } = await importing();
    cancelOf(first).click();
    fail(new Error('The server could not be created'));
    await d.tick(5);
    expect(toast.mock.calls.some((c) => /Import stopped: The server could not be created/.test(c[0]))).toBe(true);
    const second = open();
    expect(second.querySelector('[role="status"]').textContent).toBe('Stopped: The server could not be created');
    expect(pickOf(second).getAttribute('aria-busy')).toBeNull();
  });
});

describe('the frame callbacks the message list queues', () => {
  it('queues one of each kind at a time however many redraws land before the next frame (a hidden tab runs none until it is shown again)', async () => {
    await boot();
    // Frames that never come, as in a hidden tab: what is queued is counted, and run by hand.
    const pending = new Map();
    let n = 0;
    const raf = (fn) => { pending.set(++n, fn); return n; };
    const caf = (id) => { pending.delete(id); };
    const real = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = caf;
    const flush = () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn(Date.now()); } };
    try {
      const { createMessageList } = await import('../src/ui/messagelist.js');
      vi.spyOn(store, 'markRead').mockImplementation(() => {});
      Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
      store.act.c.c1 = { s: 3 };
      const list = createMessageList({ convId: 'c1' });
      document.body.append(list.el);
      flush(); // the kickoff's landing and the first drawing's date pill
      expect(pending.size).toBe(0);
      // Six polls land before the next frame, each redrawing the list.
      for (let i = 0; i < 6; i++) store.emit('workspace');
      expect(pending.size).toBe(1);
      flush();
      // Six messages arrive under a reader at the bottom.
      for (let i = 4; i < 10; i++) {
        const m = message(i);
        store.conv('c1').messages.push(m);
        store.emit('messages', { conv: 'c1', reason: 'newer', added: [m] });
      }
      expect(pending.size).toBe(2); // the date pill's, and the one following the bottom
      flush();
      // Six changes to messages already there (reactions, edits, pins) under the same reader.
      for (let i = 0; i < 6; i++) store.emit('messages', { conv: 'c1', reason: 'range' });
      expect(pending.size).toBe(2);
      // A list taken down leaves nothing queued to run on a page it has left.
      list.destroy();
      expect(pending.size).toBe(0);
    } finally {
      [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = real;
      [window.requestAnimationFrame, window.cancelAnimationFrame] = real;
    }
  });
});

describe('a paste that carries a picture and words at once', () => {
  /** A composer whose uploads land at once; `paste(files, text)` dispatches a paste carrying both and answers the event. */
  async function pasting() {
    await boot();
    vi.spyOn(store, 'uploadFor').mockImplementation(async (conv, file) => ({ id: `f-${file.name}`, name: file.name, size: file.size, type: file.type }));
    const { createComposer } = await import('../src/ui/composer.js');
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const png = { name: 'image.png', size: 1200, type: 'image/png' };
    const paste = (files, text) => {
      const e = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: { files, getData: (t) => (t === 'text/plain' ? text : '') } });
      composer.textarea.dispatchEvent(e);
      return e;
    };
    return { composer, png, paste, chips: () => [...composer.el.querySelectorAll('.chip .chip-name')].map((n) => n.textContent) };
  }

  it('attaches the picture and leaves the words to the box (a table copied from a spreadsheet comes as both), rather than dropping the words', async () => {
    const { composer, png, paste, chips } = await pasting();
    const e = paste([png], 'A1\tB1\nA2\tB2');
    await waitFor(() => chips().length === 1);
    expect(chips()).toEqual(['image.png']);
    // The browser's own paste puts the words in: it is not stopped.
    expect(e.defaultPrevented).toBe(false);
    composer.destroy();
  });

  it('a picture alone (a screenshot) is attached and the paste stopped, as before', async () => {
    const { composer, png, paste, chips } = await pasting();
    const e = paste([png], '');
    await waitFor(() => chips().length === 1);
    expect(e.defaultPrevented).toBe(true);
    composer.destroy();
  });
});

describe('the media viewer over a picture whose bytes could not be had', () => {
  /** The viewer opened on one picture whose fetch answers as `answers` says, one call at a time (a rejection, or a URL). */
  async function viewer(answers) {
    const { dom: d } = await boot();
    const files = await import('../src/lib/files.js');
    const asked = [];
    vi.spyOn(files, 'attachmentUrl').mockImplementation(async () => {
      const a = answers[Math.min(asked.length, answers.length - 1)];
      asked.push(a);
      if (a instanceof Error) throw a;
      return a;
    });
    const busy = Object.assign(new Error('The workspace server is busy right now (429); try again in a moment'), { status: 429 });
    const { openMediaViewer } = await import('../src/ui/mediaviewer.js');
    const modal = openMediaViewer({ items: [{ file: { id: 'a', name: 'one.png', type: 'image/png', size: 10 }, ref: REF, author: { name: 'Ana', uuid: 'u2' }, ts: 1_700_000_000_000 }], index: 0 });
    await d.tick(3);
    const root = modal.panel;
    const status = () => root.querySelector('.viewer-status');
    const button = (label) => [...status().querySelectorAll('button')].find((b) => b.textContent === label);
    return { d, root, status, button, asked, busy };
  }

  it('offers to try again beside the download, keeps the line while the answer is out, and hands the keyboard to Close once the picture comes', async () => {
    const busy = Object.assign(new Error('busy'), { status: 429 });
    const { d, root, status, button, asked } = await viewer([busy, 'blob:a']);
    expect(status().textContent).toContain('Could not load the image');
    expect(button('Try again')).toBeTruthy();
    expect(button('Download')).toBeTruthy();
    const retry = button('Try again');
    retry.focus();
    retry.click();
    // Busy, not replaced: the line stands with its words while the server is asked again.
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(status().textContent).toContain('Could not load the image');
    expect(document.activeElement).toBe(retry);
    await d.tick(3);
    expect(asked).toHaveLength(2);
    const img = root.querySelector('.viewer-img');
    expect(img.getAttribute('src')).toBe('blob:a');
    // The picture lands (the browser's load event): the line goes, and the keyboard with it to Close, not to the page.
    img.dispatchEvent(new Event('load'));
    expect(status().hidden).toBe(true);
    expect(img.hidden).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('[aria-label="Close"]'));
  });

  it('refused once more, keeps the keyboard on the fresh Try again', async () => {
    const busy = Object.assign(new Error('busy'), { status: 429 });
    const { d, button, asked } = await viewer([busy, busy]);
    const retry = button('Try again');
    retry.focus();
    retry.click();
    await d.tick(3);
    expect(asked).toHaveLength(2);
    const again = button('Try again');
    expect(again).toBeTruthy();
    expect(again).not.toBe(retry);
    expect(again.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(again);
  });
});

describe('the Forward dialog while the workspace changes under it', () => {
  it('drops a conversation the sender leaves meanwhile from the list, and the pick with it, rather than forwarding into a channel the worker would refuse', async () => {
    const { dom: d } = await boot();
    const { forwardMessageDialog } = await import('../src/ui/dialogs.js');
    const { openModal } = await import('../src/ui/modal.js');
    const send = vi.spyOn(store, 'send').mockResolvedValue({ seq: 9 });
    const msg = message(3, 'u2');
    const done = forwardMessageDialog(msg, { permalink: 'https://x.test/#/ws/abc123def0@teamchat-test/c/c1/m/3', author: store.member('u2'), conv: 'c1' });
    const content = openModal.mock.calls.at(-1)[0].content;
    const rows = () => [...content.querySelectorAll('.pick-item')].map((b) => b.textContent);
    const forward = [...content.querySelectorAll('button')].find((b) => b.textContent === 'Forward');
    expect(rows()).toEqual(['general', 'random']);
    [...content.querySelectorAll('.pick-item')].find((b) => b.textContent === 'random').click();
    expect(forward.disabled).toBe(false);
    // The sender leaves #random from another tab, and the poll brings it.
    store.me.channels = ['c1'];
    store.emit('workspace');
    await d.tick(1);
    expect(rows()).toEqual(['general']);
    expect(forward.disabled).toBe(true);
    forward.click();
    await d.tick(2);
    expect(send).not.toHaveBeenCalled();
    // A pick still there stays picked through such a change.
    [...content.querySelectorAll('.pick-item')].find((b) => b.textContent === 'general').click();
    store.emit('workspace');
    await d.tick(1);
    expect(forward.disabled).toBe(false);
    expect(content.querySelector('.pick-item[aria-selected="true"]').textContent).toBe('general');
    [...content.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    expect(await done).toBeNull();
  });

  /** The dialog open on a message of #general, with its option buttons and the search box to hand. */
  async function forwardOpen() {
    const { dom: d } = await boot();
    const { forwardMessageDialog } = await import('../src/ui/dialogs.js');
    const { openModal } = await import('../src/ui/modal.js');
    forwardMessageDialog(message(3, 'u2'), { permalink: 'https://x.test/#/ws/abc123def0@teamchat-test/c/c1/m/3', author: store.member('u2'), conv: 'c1' });
    const content = openModal.mock.calls.at(-1)[0].content;
    const option = (label) => [...content.querySelectorAll('.pick-item')].find((b) => b.textContent === label);
    return { d, content, option, search: content.querySelector('input[type="search"]') };
  }

  it('is not drawn again for a poll that changes none of the places (the workspace is announced with every poll): the very same buttons stand, and the keyboard stays on its option', async () => {
    const { d, option } = await forwardOpen();
    const random = option('random');
    random.focus();
    expect(document.activeElement).toBe(random);
    store.ws.channels.c1.topic = 'a topic set meanwhile';
    store.emit('workspace');
    store.emit('workspace');
    await d.tick(1);
    expect(option('random')).toBe(random);
    expect(option('general')).toBeTruthy();
    expect(document.activeElement).toBe(random);
  });

  it('drawn again for a change that takes the option under the keyboard, puts the keyboard on the first option rather than on the page; a rename keeps it on the same place', async () => {
    const { d, option } = await forwardOpen();
    option('random').focus();
    store.me.channels = ['c1'];
    store.emit('workspace');
    await d.tick(1);
    expect(option('random')).toBeUndefined();
    expect(document.activeElement).toBe(option('general'));
    // The channel under the keyboard is renamed: the keyboard stays on it, under its new name.
    store.ws.channels.c1.name = 'town-square';
    store.emit('workspace');
    await d.tick(1);
    expect(option('general')).toBeUndefined();
    expect(document.activeElement).toBe(option('town-square'));
  });
});

describe('the uploads of a message that will never go out', () => {
  it('a queued message discarded from its row asks the worker to let go of the files that had gone up, not of one still on this device', async () => {
    const { api } = await boot();
    const deleted = vi.spyOn(api, 'deleteFile').mockResolvedValue({ ok: true });
    store.outbox.remove = vi.fn(async () => {});
    const temp = {
      seq: null, tempId: 'q1', cid: 'q1', user: 'u-me', text: 'later', ts: 1, kind: 'msg', queued: true, failed: false, mentions: [], reactions: {}, replyCount: 0,
      attachments: [{ id: 'f-up', name: 'up.png', size: 5, type: 'image/png' }, { name: 'wait.png', size: 7, type: 'image/png', uploading: true }],
    };
    store.conv('c1').messages.push(temp);
    store.discard('c1', temp);
    expect(store.conv('c1').messages).not.toContain(temp);
    expect(store.outbox.remove).toHaveBeenCalledWith('q1');
    expect(deleted.mock.calls).toEqual([[REF, 'f-up']]);
  });

  it('a draft deleted from the Drafts list asks the worker to let go of the files it had put up, under the workspace the conversation lives on', async () => {
    const { dom: d, api } = await boot();
    const deleted = vi.spyOn(api, 'deleteFile').mockResolvedValue({ ok: true });
    const { setDraft, listDrafts } = await import('../src/lib/drafts.js');
    setDraft(`${REF}:c1`, { text: 'a draft with a file', attachments: [{ id: 'f-d1', name: 'd1.png', size: 5, type: 'image/png' }, { id: 'f-d2', name: 'd2.pdf', size: 9, type: 'application/pdf' }] });
    setDraft(`${REF}:c1_t3`, { text: '', attachments: [{ id: 'f-t', name: 't.png', size: 5, type: 'image/png' }] });
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('drafts');
    document.body.append(v.el);
    await d.tick(5);
    const rows = () => [...v.el.querySelectorAll('.later-row')];
    expect(rows()).toHaveLength(2);
    const row = rows().find((r) => r.textContent.includes('a draft with a file'));
    row.querySelector('[aria-label="Delete draft"]').click();
    await d.tick(2);
    expect(deleted.mock.calls).toEqual([[REF, 'f-d1'], [REF, 'f-d2']]);
    expect(listDrafts(REF).map((x) => x.conv)).toEqual(['c1_t3']);
    // A draft for a thread: the file went to the workspace the thread's channel lives on.
    rows()[0].querySelector('[aria-label="Delete draft"]').click();
    await d.tick(2);
    expect(deleted.mock.calls.at(-1)).toEqual([REF, 'f-t']);
    expect(listDrafts(REF)).toEqual([]);
    v.destroy?.();
  });

  it('a message that failed in flight and is discarded lets its files go too, and a queued message dropped with its conversation lets them go on the worker they went to', async () => {
    const { api } = await boot();
    const deleted = vi.spyOn(api, 'deleteFile').mockResolvedValue({ ok: true });
    const temp = { seq: null, tempId: 'x1', cid: 'x1', user: 'u-me', text: 'gone wrong', ts: 1, kind: 'msg', failed: true, mentions: [], reactions: {}, replyCount: 0, attachments: [{ id: 'f-a', name: 'a.pdf', size: 5, type: 'application/pdf' }, { id: 'f-b', name: 'b.pdf', size: 5, type: 'application/pdf' }] };
    store.conv('c1').messages.push(temp);
    store.discard('c1', temp);
    expect(deleted.mock.calls).toEqual([[REF, 'f-a'], [REF, 'f-b']]);
    deleted.mockClear();
    const entry = { id: 'q2', ws: REF, conv: 'sh1', text: 'to a shared channel', attachments: [{ id: 'f-h', name: 'h.png', size: 5, type: 'image/png' }], files: [], host: 'hhhhhhhhhh@host-test', hconv: 'hc1' };
    const err = store._dropQueued(entry, null);
    expect(err.drop).toBe(true);
    expect(deleted.mock.calls).toEqual([['hhhhhhhhhh@host-test', 'f-h']]);
  });
});

describe('the "N replies" line at the head of an open thread', () => {
  /** A thread panel on message 2 of #general, the root in the window, the thread's own window as given; the worker takes a deletion. */
  async function openThread(threadWindow, rootExtra = {}) {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.pokeSync = () => {};
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (init.method === 'DELETE') return json({ ok: true });
      return json({ messages: [], seq: 0 });
    };
    const root = { ...message(2), replyCount: 2, ...rootExtra };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), root] });
    Object.assign(store.conv('c1_t2'), { loaded: true, hasMore: false, ...threadWindow });
    store.act.c.c1 = { s: 2 };
    const panel = document.createElement('section');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 2, onClose() {} });
    await d.tick(3);
    return { d, panel, thread, root, count: () => panel.querySelector('.thread-count')?.textContent };
  }

  it('counts the replies alone, not the line the worker wrote when one of them was pinned', async () => {
    // Two replies, the second pinned: "Me pinned a message" stands among them in the thread, and counts on no root.
    const { thread, count } = await openThread({ seq: 3, messages: [message(1, 'u3'), { ...message(2, 'u-me'), pinned: true }, { ...message(3, 'u-me'), kind: 'sys', text: 'Me pinned a message' }] });
    expect(count()).toBe('2 replies');
    thread.destroy();
  });

  it('and a line the worker wrote does not count where the root\'s own count says fewer than the lines loaded', async () => {
    // One reply and the line for its pinning; the root knows of one reply.
    const { thread, count } = await openThread({ seq: 2, messages: [{ ...message(1, 'u3'), pinned: true }, { ...message(2, 'u-me'), kind: 'sys', text: 'Me pinned a message' }] }, { replyCount: 1 });
    expect(count()).toBe('1 reply');
    thread.destroy();
  });

  it('follows a reply deleted from a thread whose root the channel\'s window does not hold (fetched on its own for the panel), which nothing else lowers', async () => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.pokeSync = () => {};
    const root = { ...message(5, 'u-me'), text: 'root 5', replyCount: 2 };
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/messages') && u.searchParams.get('from') === '5') return json({ messages: [root], seq: 45 });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      if (init.method === 'DELETE') return json({ ok: true });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    // The window holds 44 and 45 alone; the thread's own window is whole.
    Object.assign(store.conv('c1'), { loaded: true, seq: 45, hasMore: true, messages: [message(44), message(45)] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 2, hasMore: false, messages: [{ ...message(1, 'u3'), text: 'r1' }, { ...message(2, 'u-me'), text: 'r2' }] });
    store.act.c.c1 = { s: 45, pc: 0 };
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(10);
    const count = () => panel.querySelector('.thread-count')?.textContent;
    expect(count()).toBe('2 replies');
    expect(store.conv('c1').messages.find((m) => m.seq === 5)).toBeUndefined();
    // The reader deletes their reply from the thread.
    await store.remove('c1_t5', 2, store.conv('c1_t5').messages[1]);
    await d.tick(3);
    expect(count()).toBe('1 reply');
    // And the other reply, deleted by its author elsewhere and gone with the poll's re-read of the thread.
    store.conv('c1_t5').messages = [];
    store.emit('messages', { conv: 'c1_t5', reason: 'range' });
    await d.tick(3);
    expect(count()).toBeUndefined();
    thread.destroy();
  });

  it('but leaves a root the window holds to the store, which lowers that copy itself, rather than counting the deletion twice', async () => {
    const { d, thread, count, root } = await openThread({ seq: 2, messages: [message(1, 'u3'), message(2, 'u-me')] });
    expect(count()).toBe('2 replies');
    await store.remove('c1_t2', 2);
    await d.tick(3);
    // The store's own word on the parent window's copy (its remove lowers it) comes as a change to the channel.
    root.replyCount = 1;
    store.emit('messages', { conv: 'c1', reason: 'local' });
    await d.tick(3);
    expect(count()).toBe('1 reply');
    thread.destroy();
  });

  it('still says the root\'s count over a long thread whose older replies are not loaded', async () => {
    const { thread, count } = await openThread({ seq: 5, hasMore: true, messages: [message(4, 'u3'), message(5, 'u-me')] }, { replyCount: 5 });
    expect(count()).toBe('5 replies');
    thread.destroy();
  });
});
