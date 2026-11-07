/**
 * Conversation UI (review pass 22), driven in node through
 * tests/helpers/dom.js as the pass-19 to pass-21 files are: a fresh DOM and
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

describe('an address with a port, typed without a scheme', () => {
  it('is saved by the bookmarks form as an https link, as a bare address is; a scheme of its own is still refused', async () => {
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
    // A development server, an intranet host with a port, a host and port with a path: each means https, as "example.com" does.
    for (const [typed, saved] of [['localhost:5173/admin', 'https://localhost:5173/admin'], ['grafana.internal:3000', 'https://grafana.internal:3000'], ['example.com:8443/docs?x=1', 'https://example.com:8443/docs?x=1']]) {
      update.mockClear();
      d.type(labelInput, 'Dev');
      d.type(urlInput, typed);
      submit();
      await d.tick(3);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0][2].bookmarks.at(-1)).toEqual({ label: 'Dev', url: saved });
      expect(error().hidden).toBe(true);
    }
    // What pass 21 fixed stands: a link with a scheme of its own is refused rather than dressed as https.
    for (const typed of ['mailto:ana@example.com', 'javascript:alert(1)', 'ftp://files.example.com/x', 'tel:+15551234567']) {
      update.mockClear();
      d.type(labelInput, 'Mail');
      d.type(urlInput, typed);
      submit();
      await d.tick(2);
      expect(update).not.toHaveBeenCalled();
      expect(error().hidden).toBe(false);
      expect(error().textContent).toContain('starting with https://');
    }
  });

  it('goes into a message from the box’s link popover as an https address, as a bare address does', async () => {
    await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
    document.body.append(box.el);
    // The test DOM's box has no setRangeText: the browser's, in short.
    box.textarea.setRangeText = function setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); };
    const add = async (typed) => {
      box.textarea.value = '';
      box.textarea.setSelectionRange(0, 0);
      box.el.querySelector('[aria-label="Link"]').click();
      const input = document.querySelector('.link-pop input');
      dom.type(input, typed);
      input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await dom.tick(1);
      return box.textarea.value;
    };
    expect(await add('localhost:5173/admin')).toBe('https://localhost:5173/admin');
    expect(await add('example.com:8080')).toBe('https://example.com:8080');
    // As typed, still: an address with a scheme of its own.
    expect(await add('mailto:ana@example.com')).toBe('mailto:ana@example.com');
    expect(await add('example.com')).toBe('https://example.com');
    box.destroy();
  });
});

describe('several files picked at once', () => {
  const files = [{ name: 'a.pdf', size: 10, type: 'application/pdf' }, { name: 'b.pdf', size: 20, type: 'application/pdf' }, { name: 'c.pdf', size: 30, type: 'application/pdf' }];
  /** A box on #general whose uploads are held until finished here, in the order they began. */
  async function boxWithHeldUploads() {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const pending = [];
    vi.spyOn(store, 'uploadFor').mockImplementation((conv, file) => new Promise((r) => pending.push({ file, r })));
    const key = `${REF}:c1`;
    const open = () => {
      const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const chips = (box) => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent} ${c.querySelector('.small').textContent}`);
    const pick = (box, list) => {
      const input = box.el.querySelector('input[type="file"]');
      input.files = list;
      input.dispatchEvent(new Event('change'));
    };
    return { d, open, chips, pick, pending, key };
  }

  it('take their chips at once, the first going up and the others waiting their turn, and Send waits for all of them', async () => {
    const { d, open, chips, pick, pending } = await boxWithHeldUploads();
    const box = open();
    pick(box, files);
    await d.tick(2);
    // One upload out, three chips: the drop lost nothing.
    expect(pending.map((p) => p.file.name)).toEqual(['a.pdf']);
    expect(chips(box)).toEqual(['a.pdf uploading', 'b.pdf waiting', 'c.pdf waiting']);
    expect(box.el.querySelector('.send-btn').disabled).toBe(true);
    pending[0].r({ id: 'f1', ...files[0] });
    await d.tick(2);
    expect(pending.map((p) => p.file.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(chips(box)).toEqual(['a.pdf 10 B', 'b.pdf uploading', 'c.pdf waiting']);
    pending[1].r({ id: 'f2', ...files[1] });
    await d.tick(2);
    expect(pending.map((p) => p.file.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(chips(box)).toEqual(['a.pdf 10 B', 'b.pdf 20 B', 'c.pdf uploading']);
    pending[2].r({ id: 'f3', ...files[2] });
    await d.tick(2);
    expect(chips(box)).toEqual(['a.pdf 10 B', 'b.pdf 20 B', 'c.pdf 30 B']);
    expect(box.el.querySelector('.send-btn').disabled).toBe(false);
    box.destroy();
  });

  it('never send up a file whose chip was removed while it waited, and show the waiting ones in a box opened next', async () => {
    const { d, open, chips, pick, pending, key } = await boxWithHeldUploads();
    const { getDraft } = await import('../src/lib/drafts.js');
    const a = open();
    d.type(a.textarea, 'hello');
    pick(a, files);
    await d.tick(2);
    // The second file is taken out before its turn came...
    a.el.querySelector('.chip button[aria-label="Remove b.pdf"]').click();
    expect(chips(a)).toEqual(['a.pdf uploading', 'c.pdf waiting']);
    // ...and the reader leaves and comes back: the box opened next shows what is still on its way.
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual(['a.pdf uploading', 'c.pdf waiting']);
    pending[0].r({ id: 'f1', ...files[0] });
    await d.tick(3);
    // The upload skipped the removed file and went on to the third.
    expect(pending.map((p) => p.file.name)).toEqual(['a.pdf', 'c.pdf']);
    expect(chips(b)).toEqual(['a.pdf 10 B', 'c.pdf uploading']);
    pending[1].r({ id: 'f3', ...files[2] });
    await d.tick(3);
    expect(chips(b)).toEqual(['a.pdf 10 B', 'c.pdf 30 B']);
    expect(getDraft(key)).toMatchObject({ text: 'hello', attachments: [{ id: 'f1', ...files[0] }, { id: 'f3', ...files[2] }] });
    b.destroy();
  });
});

describe('a file picked while offline, sent up for a message scheduled with Send later', () => {
  it('says "uploading" on its chip while it goes up, and the message is scheduled with its id', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const pending = [];
    vi.spyOn(store, 'uploadFor').mockImplementation(() => new Promise((r) => pending.push(r)));
    const onSendLater = vi.fn(async () => ({}));
    const box = createComposer({ onSend: vi.fn(), onSendLater, convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
    document.body.append(box.el);
    const chips = () => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent} ${c.querySelector('.small').textContent}`);
    // Offline: the file keeps its bytes in the box, and Send may go (the outbox would carry them).
    d.navigator.onLine = false;
    const input = box.el.querySelector('input[type="file"]');
    input.files = [{ name: 'plan.pdf', size: 1234, type: 'application/pdf' }];
    input.dispatchEvent(new Event('change'));
    await d.tick(2);
    expect(chips()).toEqual(['plan.pdf 1.2 KB']);
    expect(pending).toHaveLength(0);
    // Back online, the reader schedules the message: the file goes up first, and the chip says so.
    d.navigator.onLine = true;
    d.type(box.textarea, 'later');
    box.el.querySelector('.send-later').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.getAttribute('role') === 'menuitem' && !b.textContent.includes('Custom')).click();
    await d.tick(2);
    expect(pending).toHaveLength(1);
    expect(chips()).toEqual(['plan.pdf uploading']);
    pending[0]({ id: 'f1', name: 'plan.pdf', size: 1234, type: 'application/pdf' });
    await d.tick(3);
    expect(onSendLater).toHaveBeenCalledTimes(1);
    expect(onSendLater.mock.calls[0][1]).toEqual([{ id: 'f1', name: 'plan.pdf', size: 1234, type: 'application/pdf' }]);
    expect(chips()).toEqual([]);
    box.destroy();
  });
});

describe('a menu item that cannot be used just now', () => {
  it('stays in the menu’s walk, dimmed and inert, so its explanation can be reached and heard', async () => {
    const { dom: d } = await boot();
    const { openMenu, pointAnchor } = await import('../src/ui/menu.js');
    const picked = vi.fn();
    const pop = openMenu(pointAnchor(200, 200), [
      { label: 'Rotate token', icon: 'key', disabled: true, sub: 'An admin in its private channel can rotate it', onSelect: picked },
      { label: 'Revoke', icon: 'trash', danger: true, onSelect: picked },
    ]);
    await d.tick(1);
    const items = [...pop.node.querySelectorAll('[role="menuitem"]')];
    expect(items.map((n) => n.getAttribute('aria-disabled'))).toEqual(['true', null]);
    // Not a disabled button: reached by the arrows and by Tab, as the pattern has it.
    expect(items[0].hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(items[0]);
    d.key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    d.key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].querySelector('.menu-sub').textContent).toBe('An admin in its private channel can rotate it');
    // Pressed all the same: nothing happens, and the menu stands.
    items[0].click();
    await d.tick(1);
    expect(picked).not.toHaveBeenCalled();
    expect(document.querySelector('.menu[role="menu"]')).toBe(pop.node);
    // The live item works as before.
    items[1].click();
    await d.tick(2);
    expect(picked).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.menu[role="menu"]')).toBeNull();
  });
});

describe('the export dialog when some attachments could not be written', () => {
  it('says how many, and that every message is saved, rather than "Saved" alone', async () => {
    const { dom: d } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const archiveLib = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    const archive = {
      header: { workspace: { id: 'abc123def0', name: 'Globex' }, exportedAt: 1_700_000_000_000, members: {}, channels: { c1: { name: 'general' } } },
      pages: [{ conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u2', text: 'hi', ts: 1, kind: 'msg', attachments: [{ id: 'fileaaaa0001', name: 'a.png', size: 4, type: 'image/png' }, { id: 'fileaaaa0002', name: 'b.png', size: 4, type: 'image/png' }], reactions: {} }] }],
      files: [{ id: 'fileaaaa0001', name: 'a.png', size: 4, type: 'image/png', conv: 'c1', seq: 1 }, { id: 'fileaaaa0002', name: 'b.png', size: 4, type: 'image/png', conv: 'c1', seq: 1 }],
    };
    archiveLib.exportWorkspace.mockResolvedValue(archive);
    // The drive takes every write; the server has the bytes of neither file (the worker answers 404 to everything here).
    const written = [];
    globalThis.puter.fs = { write: async (path) => { written.push(path); return { path }; } };
    const { exportDialog } = await import('../src/ui/dialogs.js');
    exportDialog();
    const start = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export now');
    start.click();
    // Waited for, not timed: the export writes its files through the drive a
    // few at a time and reads their bytes with retries, and a fixed ten
    // milliseconds fell short under a loaded machine.
    const done = async () => { for (let i = 0; i < 500 && !document.querySelector('[role="status"]')?.textContent.includes('Done.'); i++) await d.tick(10); };
    await done();
    const status = document.querySelector('[role="status"]');
    expect(status.textContent).toContain('Done. Saved to');
    expect(status.textContent).toContain('Every message is there; 2 attachments could not be written into its files folder');
    expect(written.some((p) => p.endsWith('messages.json'))).toBe(true);
    expect(written.some((p) => p.includes('/files/'))).toBe(false);
    expect(toast).toHaveBeenCalledWith('Workspace exported; 2 attachments could not be written', expect.objectContaining({ icon: 'alert' }));
    // Every attachment written: the words as before, and no count.
    toast.mockClear();
    globalThis.puter.workers.exec = async () => new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } });
    document.body.replaceChildren();
    exportDialog();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export now').click();
    await done();
    const again = document.querySelector('[role="status"]');
    expect(again.textContent).toContain('Done. Saved to');
    expect(again.textContent).not.toContain('could not be written');
    expect(toast).toHaveBeenCalledWith('Workspace exported', {});
  });
});

describe('a link preview’s description', () => {
  it('wraps a long unbroken run (an address) inside its three lines rather than clipping it at the card’s edge', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    const rule = css.match(/\.unfurl-desc \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/overflow-wrap: anywhere;/);
    // As the title beside it has had all along.
    expect(css.match(/\.unfurl-title \{([^}]*)\}/)[1]).toMatch(/overflow-wrap: anywhere;/);
  });
});

describe('the keyboard when a conversation opens on a phone', () => {
  const setup = async (env) => {
    const { dom: d } = await boot(env);
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    // The sidebar's row of the conversation, tapped: it holds the keyboard as the conversation is asked for.
    const aside = document.createElement('div');
    const row = document.createElement('a');
    row.setAttribute('href', '#/ws/x/c/c1');
    row.textContent = 'general';
    aside.append(row);
    document.body.append(aside);
    row.focus();
    expect(document.activeElement).toBe(row);
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    return { d, view, aside, row };
  };

  it('lands on the column’s first control that is not a text box (Back), the sidebar row having gone with the sidebar', async () => {
    const { d, view, aside, row } = await setup({ width: 400, coarse: true, hover: false });
    // The shell shows the conversation and hides the sidebar with the row in it.
    document.body.append(view.el);
    aside.hidden = true;
    await d.tick(3);
    expect(document.activeElement).toBe(view.el.querySelector('.conv-header .back'));
    expect(document.activeElement).not.toBe(row);
    view.destroy();
  });

  it('leaves the keyboard where it is when that is still on screen (a tablet’s sidebar row beside the column)', async () => {
    const { d, view, row } = await setup({ width: 1024, coarse: true, hover: false });
    document.body.append(view.el);
    await d.tick(3);
    expect(document.activeElement).toBe(row);
    view.destroy();
  });

  it('still gives the message box the keyboard where there is a mouse', async () => {
    const { d, view, aside } = await setup({ width: 1280 });
    document.body.append(view.el);
    aside.hidden = true;
    await d.tick(3);
    expect(document.activeElement).toBe(view.el.querySelector('textarea'));
    view.destroy();
  });
});

describe('a file picked while offline, the conversation left and come back to', () => {
  const blob = { name: 'plan.pdf', size: 1234, type: 'application/pdf' };
  async function boxes() {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    const key = `${REF}:c1`;
    const onSend = vi.fn(async () => ({}));
    const open = () => {
      const box = createComposer({ onSend, convId: 'c1', typingConv: 'c1', draftKey: key });
      document.body.append(box.el);
      return box;
    };
    const chips = (box) => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent} ${c.querySelector('.small').textContent}`);
    const pick = (box) => {
      const input = box.el.querySelector('input[type="file"]');
      input.files = [blob];
      input.dispatchEvent(new Event('change'));
    };
    return { d, open, chips, pick, onSend };
  }

  it('is in the box again with its bytes kept on this device, goes with the message, and is kept for nobody once sent', async () => {
    const { d, open, chips, pick, onSend } = await boxes();
    d.navigator.onLine = false;
    const a = open();
    d.type(a.textarea, 'offline note');
    pick(a);
    await d.tick(2);
    expect(chips(a)).toEqual(['plan.pdf 1.2 KB']);
    // The conversation is left (the box goes) and come back to.
    a.destroy();
    a.el.remove();
    const b = open();
    expect(b.textarea.value).toBe('offline note');
    expect(chips(b)).toEqual(['plan.pdf 1.2 KB']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(false);
    d.navigator.onLine = true;
    b.el.querySelector('.send-btn').click();
    await d.tick(2);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][2]).toEqual([{ name: 'plan.pdf', type: 'application/pdf', blob }]);
    b.destroy();
    b.el.remove();
    const c = open();
    expect(chips(c)).toEqual([]);
    c.destroy();
  });

  it('is not brought back once its chip was taken out', async () => {
    const { d, open, chips, pick } = await boxes();
    d.navigator.onLine = false;
    const a = open();
    pick(a);
    await d.tick(2);
    a.destroy();
    a.el.remove();
    const b = open();
    expect(chips(b)).toEqual(['plan.pdf 1.2 KB']);
    b.el.querySelector('.chip button[aria-label="Remove plan.pdf"]').click();
    expect(chips(b)).toEqual([]);
    b.destroy();
    b.el.remove();
    const c = open();
    expect(chips(c)).toEqual([]);
    c.destroy();
  });
});

describe('a picture whose bytes could not be fetched', () => {
  it('stands as its file card in the link’s place (no button inside an anchor), downloads on activation, and still folds under its caption', async () => {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const { renderMessage } = await import('../src/ui/message.js');
    const ctx = { convId: 'c1', onShowMember() {}, membersByUsername: store.membersByUsername() };
    // The worker answers 404 to everything here: the picture's bytes cannot be had.
    const row = renderMessage(message(1, 'u2', { attachments: [{ id: 'f1', name: 'pic.png', size: 10, type: 'image/png' }] }), ctx);
    document.body.append(row);
    await d.tick(3);
    const box = row.querySelector('.attachment-image');
    expect(box.querySelector('a')).toBeNull();
    const card = box.querySelector('button.attachment');
    expect(card).toBeTruthy();
    expect(card.getAttribute('aria-label')).toBe('Download pic.png');
    expect(card.closest('a')).toBeNull();
    expect(row.querySelectorAll('a button, button button')).toHaveLength(0);
    // Activated (Enter on a button is a click): the download is tried, and its failure said.
    card.click();
    await d.tick(3);
    expect(toast).toHaveBeenCalledWith('Could not download the file', expect.objectContaining({ icon: 'alert' }));
    // The caption folds the card as it folded the picture.
    const caption = box.querySelector('.att-caption');
    caption.click();
    expect(card.hidden).toBe(true);
    expect(caption.getAttribute('aria-expanded')).toBe('false');
    caption.click();
    expect(card.hidden).toBe(false);
  });
});

describe('the arrow keys in the lists of "Forward this message" and "New message"', () => {
  const walk = (d, items) => {
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);
    expect(d.key(document.activeElement, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    d.key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    d.key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
    // At the top, Up stays; the key is left to the page.
    expect(d.key(document.activeElement, 'ArrowUp').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[0]);
    // Tab is not the list's: it goes on as before.
    expect(d.key(document.activeElement, 'Tab').defaultPrevented).toBe(false);
  };

  it('step through the places to forward to, Home and End to the ends', async () => {
    const { dom: d } = await boot();
    const { forwardMessageDialog } = await import('../src/ui/dialogs.js');
    forwardMessageDialog(message(1), { permalink: 'https://app.test/#/ws/x/c/c1/m/1', author: { name: 'Ana Rocha' }, conv: 'c1' });
    await d.tick(1);
    const items = [...document.querySelectorAll('.pick-list[aria-label="Forward to"] .pick-item')];
    expect(items.map((n) => n.textContent)).toEqual(['general', 'random']);
    walk(d, items);
  });

  it('step through the people of a new message, Home and End to the ends', async () => {
    const { dom: d } = await boot();
    const { newDmDialog } = await import('../src/ui/dialogs.js');
    newDmDialog();
    await d.tick(1);
    const items = [...document.querySelectorAll('.pick-list[aria-label="People"] .pick-item')];
    expect(items).toHaveLength(2);
    walk(d, items);
  });
});

describe('a share link missing its server part, pasted into "Join a workspace"', () => {
  it('is refused as a share link that is not valid, not as something that does not look like an invite', async () => {
    const { dom: d } = await boot();
    const { joinWorkspaceDialog } = await import('../src/ui/dialogs.js');
    const join = vi.spyOn(store, 'join').mockResolvedValue({ workspace: { id: REF, name: 'Globex' } });
    joinWorkspaceDialog();
    const form = document.querySelector('form');
    const input = form.querySelector('input');
    d.type(input, 'https://app.test/#/connect/ABCD-EFGH-IJKL');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(2);
    const error = form.querySelector('.field-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('That share link is not valid');
    expect(error.textContent).toContain('names the server');
    expect(error.textContent).not.toContain('does not look like an invite');
    expect(join).not.toHaveBeenCalled();
    expect(document.querySelector('form')).toBe(form); // the dialog stands
    // A whole share link still goes on to the shared-channel dialog, and an invite still joins.
    d.type(input, 'https://app.test/#/connect/teamchat-test/ABCD-EFGH-IJKL');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await d.tick(2);
    expect(document.querySelector('form')).not.toBe(form);
    expect(join).not.toHaveBeenCalled();
  });
});

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });

/** A conversation view on #general with the given messages, its rows and the popovers on the page. */
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
  const picker = () => document.querySelector('.menu.emoji-pop');
  const item = (text) => [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes(text));
  return { d, view, rows, menu, picker, item };
}

describe('the row a reaction picker or a submenu stands open on', () => {
  it('is held lit with its hover bar drawn (menu-open) while the picker opened from the bar stands, through a redraw, and let go when it closes', async () => {
    const { d, view, rows, picker } = await openView([message(1), message(2)]);
    const old = rows()[0];
    old.querySelector('.msg-actions [aria-label="Add reaction"]').click();
    await d.tick(1);
    expect(picker()).toBeTruthy();
    expect(old.classList.contains('menu-open')).toBe(true);
    expect(rows()[1].classList.contains('menu-open')).toBe(false);
    // The poll brings the workspace afresh: every row is a new element, and the fresh one holds the class.
    store.emit('workspace');
    await d.tick(2);
    const fresh = rows()[0];
    expect(fresh).not.toBe(old);
    expect(picker()).toBeTruthy();
    expect(fresh.classList.contains('menu-open')).toBe(true);
    d.key(document.activeElement, 'Escape');
    await d.tick(2);
    expect(picker()).toBeNull();
    expect(view.el.querySelector('.msg.menu-open')).toBeNull();
    expect(old.classList.contains('menu-open')).toBe(false);
    view.destroy();
  });

  it('is held lit under the picker and the reminder times opened from the message menu, and let go when they close', async () => {
    const { d, view, rows, menu, picker, item } = await openView([message(1), message(2)]);
    const row = rows()[0];
    row.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    expect(menu()).toBeTruthy();
    item('Add reaction').click();
    await d.tick(1);
    expect(menu()).toBeNull();
    expect(picker()).toBeTruthy();
    expect(row.classList.contains('menu-open')).toBe(true);
    d.key(document.activeElement, 'Escape');
    await d.tick(2);
    expect(picker()).toBeNull();
    expect(row.classList.contains('menu-open')).toBe(false);
    row.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    item('Remind me about this').click();
    await d.tick(1);
    const sub = menu();
    expect(sub).toBeTruthy();
    expect(sub.getAttribute('aria-label')).toBe('Remind me');
    expect(row.classList.contains('menu-open')).toBe(true);
    d.key(document.activeElement, 'Escape');
    await d.tick(2);
    expect(menu()).toBeNull();
    expect(row.classList.contains('menu-open')).toBe(false);
    view.destroy();
  });
});
