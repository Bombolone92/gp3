/**
 * Conversation UI (review pass 23), driven in node through
 * tests/helpers/dom.js as the pass-19 to pass-22 files are: a fresh DOM and
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

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });

/** A box on #general whose uploads are held until finished here, in the order they began. */
async function boxWithHeldUploads() {
  const { dom: d } = await boot();
  const { createComposer } = await import('../src/ui/composer.js');
  const pending = [];
  vi.spyOn(store, 'uploadFor').mockImplementation((conv, file) => new Promise((r) => pending.push({ file, r })));
  const key = `${REF}:c1`;
  const onSend = vi.fn(async () => ({}));
  const open = () => {
    const box = createComposer({ onSend, convId: 'c1', typingConv: 'c1', draftKey: key });
    document.body.append(box.el);
    return box;
  };
  const chips = (box) => [...box.el.querySelectorAll('.chip')].map((c) => `${c.querySelector('.chip-name').textContent} ${c.querySelector('.small').textContent}`);
  const pick = (box, list) => {
    const input = box.el.querySelector('input[type="file"]');
    input.files = list;
    input.dispatchEvent(new Event('change'));
  };
  return { d, open, chips, pick, pending, key, onSend };
}

describe('files picked together, the conversation left while the first goes up, and the connection dropping before the next one’s turn', () => {
  const files = [{ name: 'a.pdf', size: 10, type: 'application/pdf' }, { name: 'b.pdf', size: 20, type: 'application/pdf' }];

  it('keeps the waiting file, bytes and all, for the box opened next on the conversation, and it goes with the message', async () => {
    const { d, open, chips, pick, pending, key, onSend } = await boxWithHeldUploads();
    const { getDraft } = await import('../src/lib/drafts.js');
    const a = open();
    d.type(a.textarea, 'two files');
    pick(a, files);
    await d.tick(2);
    expect(chips(a)).toEqual(['a.pdf uploading', 'b.pdf waiting']);
    // The reader leaves the conversation (the box goes), and the connection goes with it.
    a.destroy();
    a.el.remove();
    d.navigator.onLine = false;
    // The first file lands (its bytes were on their way); the second's turn finds no connection, so nothing more goes up.
    pending[0].r({ id: 'f1', ...files[0] });
    await d.tick(3);
    expect(pending).toHaveLength(1);
    expect(getDraft(key)).toMatchObject({ text: 'two files', attachments: [{ id: 'f1', ...files[0] }] });
    // Back on the conversation: both files are in the box, the second with its bytes kept on this device, and Send may go.
    const b = open();
    expect(b.textarea.value).toBe('two files');
    expect(chips(b)).toEqual(['a.pdf 10 B', 'b.pdf 20 B']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(false);
    d.navigator.onLine = true;
    b.el.querySelector('.send-btn').click();
    await d.tick(2);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][1]).toEqual([{ id: 'f1', ...files[0] }]);
    expect(onSend.mock.calls[0][2]).toEqual([{ name: 'b.pdf', type: 'application/pdf', blob: files[1] }]);
    // Sent, it is kept for nobody.
    b.destroy();
    b.el.remove();
    const c = open();
    expect(chips(c)).toEqual([]);
    c.destroy();
  });

  it('shows the file as kept offline in a box already open on the conversation when its turn comes', async () => {
    const { d, open, chips, pick, pending } = await boxWithHeldUploads();
    const a = open();
    pick(a, files);
    await d.tick(2);
    a.destroy();
    a.el.remove();
    // The box opened next takes the files on their way as they are...
    const b = open();
    expect(chips(b)).toEqual(['a.pdf uploading', 'b.pdf waiting']);
    // ...and the connection goes before the second's turn: it stays, with its bytes, and Send waits for nothing.
    d.navigator.onLine = false;
    pending[0].r({ id: 'f1', ...files[0] });
    await d.tick(3);
    expect(pending).toHaveLength(1);
    expect(chips(b)).toEqual(['a.pdf 10 B', 'b.pdf 20 B']);
    expect(b.el.querySelector('.send-btn').disabled).toBe(false);
    // Left again and come back to: still there.
    b.destroy();
    b.el.remove();
    const c = open();
    expect(chips(c)).toEqual(['a.pdf 10 B', 'b.pdf 20 B']);
    c.destroy();
  });
});

describe('the keyboard when a thread opens on a touch screen', () => {
  /** The conversation column with a thread's "2 replies" line under the keyboard (a tap on it opened the thread), and the panel the thread is drawn into over it. */
  const setup = async (env) => {
    const { dom: d } = await boot(env);
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const root = { ...message(2), replyCount: 2 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), root] });
    Object.assign(store.conv('c1_t2'), { loaded: true, seq: 2, hasMore: false, messages: [message(1, 'u3'), message(2, 'u3')] });
    store.act.c.c1 = { s: 2 };
    const main = document.createElement('div');
    main.className = 'main';
    const link = document.createElement('button');
    link.className = 'thread-link';
    link.textContent = '2 replies';
    main.append(link);
    const panel = document.createElement('section');
    panel.className = 'panel';
    document.body.append(main, panel);
    link.focus();
    expect(document.activeElement).toBe(link);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 2, onClose() {} });
    await d.tick(5);
    return { d, panel, link, thread };
  };

  it('lands on the panel’s first control that is not a text box, rather than staying on the line tapped in the column under the panel', async () => {
    const { panel, link, thread } = await setup({ width: 400, coarse: true, hover: false });
    expect(document.activeElement).not.toBe(link);
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('.panel-head [aria-label="Follow this thread"]'));
    // Not the reply box, which would raise the phone's keyboard over the thread.
    expect(document.activeElement.localName).toBe('button');
    thread.destroy();
  });

  it('still gives the reply box the keyboard where there is a mouse', async () => {
    const { panel, thread } = await setup({ width: 1280 });
    expect(document.activeElement).toBe(panel.querySelector('textarea'));
    thread.destroy();
  });
});

describe('the arrow keys in the list of channels a bot may use', () => {
  const walk = (d, items) => {
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);
    expect(d.key(document.activeElement, 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    d.key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    d.key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
    // At the top, Up stays; the key is left to the page. Tab is not the list's.
    expect(d.key(document.activeElement, 'ArrowUp').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[0]);
    expect(d.key(document.activeElement, 'Tab').defaultPrevented).toBe(false);
  };

  it('step through the channels of a new bot token, Home and End to the ends, as through the people of a new message', async () => {
    const { dom: d } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    const { integrationsDialog } = await import('../src/ui/dialogs.js');
    integrationsDialog();
    await d.tick(3);
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New bot token')).click();
    await d.tick(1);
    const list = document.querySelector('.pick-list[aria-label="Channels the bot may use"]');
    const items = [...list.querySelectorAll('.pick-item')];
    expect(items.map((n) => n.textContent)).toEqual(['general', 'random']);
    walk(d, items);
    // A pick still toggles the channel, and the keyboard stays on it.
    d.key(document.activeElement, 'ArrowDown');
    document.activeElement.click();
    await d.tick(1);
    const again = [...document.querySelector('.pick-list[aria-label="Channels the bot may use"]').querySelectorAll('.pick-item')];
    expect(again[1].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(again[1]);
  });

  it('step through the channels of a bot being edited too', async () => {
    const { dom: d, api } = await boot();
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    vi.spyOn(api, 'integrations').mockResolvedValue({ webhooks: [], bots: [{ id: 'b1', name: 'Reader', channels: ['c1'], scopes: ['read'], lastUsed: 0 }] });
    const { integrationsDialog } = await import('../src/ui/dialogs.js');
    integrationsDialog();
    await d.tick(5);
    document.querySelector('button[aria-label="Manage Reader"]').click();
    await d.tick(2);
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Channels and scopes')).click();
    await d.tick(2);
    const list = document.querySelector('.pick-list[aria-label="Channels the bot may use"]');
    const items = [...list.querySelectorAll('.pick-item')];
    expect(items.map((n) => n.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    walk(d, items);
  });
});

describe('a name of many letters with no space to break at, where the conversation side shows one', () => {
  it('wraps inside its box rather than running out of it: a details row’s label, the author over a forwarded message’s preview, the people named where a direct message’s box would be, who pinned a message, and the emoji search’s own words', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    const body = (css, selector) => {
      const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
      expect(m, selector).not.toBeNull();
      return m[1];
    };
    // A bookmark's label, an integration's name, a shared channel's name (the line under them already wrapped).
    expect(body(app, '.details-row .details-text strong')).toMatch(/overflow-wrap: anywhere;/);
    expect(body(app, '.details-row .details-text span')).toMatch(/overflow-wrap: anywhere;/);
    // The author of the message being forwarded, a flex item that must be allowed to shrink to wrap.
    expect(body(components, '.forward-preview-head strong')).toMatch(/min-width: 0; overflow-wrap: anywhere;/);
    // "Ana is no longer in Globex" over the box's place, and the column it stands in.
    expect(body(app, '.composer-blocked .read-only-text strong')).toMatch(/overflow-wrap: anywhere;/);
    expect(body(app, '.composer-blocked .read-only-text')).toMatch(/min-width: 0;/);
    // "Pinned by" someone, under a pin; the pinned message's author already wrapped.
    expect(body(app, '.pin-meta')).toMatch(/overflow-wrap: anywhere;/);
    expect(body(app, '.pin-head strong')).toMatch(/overflow-wrap: anywhere;/);
    // "Nothing matches “…”" quotes the search box, which takes any length.
    expect(body(components, '.emoji-empty')).toMatch(/overflow-wrap: anywhere;/);
  });
});

describe('a long file name cut in the middle for a chip or a card', () => {
  it('is cut between whole characters as the reader sees them: a flag or a joined family at the cut is kept whole or left out, never halved', async () => {
    const { fileLabelShort } = await import('../src/ui/filename.js');
    const seg = new Intl.Segmenter();
    const whole = (s) => [...seg.segment(s)].map((g) => g.segment);
    const flags = `${'🇺🇸'.repeat(20)}.png`; // 44 code points, 24 characters to the eye
    const shortFlags = fileLabelShort(flags);
    expect(shortFlags).toContain('…');
    // Every character on either side of the ellipsis is a whole flag (two code points), the extension kept.
    const [head, tail] = shortFlags.split('…');
    expect(whole(head).every((g) => g === '🇺🇸')).toBe(true);
    expect(tail.endsWith('.png')).toBe(true);
    expect(whole(tail).slice(0, -4).every((g) => g === '🇺🇸')).toBe(true);
    // A family joined with zero-width joiners (five code points each) at the cut, likewise.
    const family = `${'👨‍👩‍👧'.repeat(12)}-photo.jpg`;
    const shortFamily = fileLabelShort(family);
    const [fh, ft] = shortFamily.split('…');
    expect(whole(fh).every((g) => g === '👨‍👩‍👧')).toBe(true);
    expect(ft.endsWith('-photo.jpg')).toBe(true);
    // Within the budget the label is as long as before: the pass-19 example stands, and a short name is left whole.
    expect(fileLabelShort('quarterly-report-final-v3-2026-09-07.pdf')).toBe('quarterly-report-fi…26-09-07.pdf');
    expect(fileLabelShort('notes.txt')).toBe('notes.txt');
    expect(fileLabelShort(flags.slice(0, 24))).toBe(flags.slice(0, 24)); // 24 code points, within the 32
  });
});

describe('the people left over once "New message" has its eight', () => {
  it('are dimmed and inert but still in the arrows’ walk, rather than disabled buttons that look live, light up under the pointer and do nothing', async () => {
    const { dom: d } = await boot();
    for (let i = 4; i <= 12; i++) store.ws.members[`u${i}`] = { role: 'member', name: `Person ${String(i).padStart(2, '0')}`, username: `p${i}`, color: 1 };
    const { newDmDialog } = await import('../src/ui/dialogs.js');
    newDmDialog();
    await d.tick(1);
    const items = () => [...document.querySelectorAll('.pick-list[aria-label="People"] .pick-item')];
    expect(items()).toHaveLength(11);
    // Eight picked: the cap of a direct message.
    for (let i = 0; i < 8; i++) items()[i].click();
    expect(items().filter((n) => n.getAttribute('aria-checked') === 'true')).toHaveLength(8);
    const rest = items().slice(8);
    expect(rest.map((n) => n.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true']);
    expect(rest.every((n) => !n.hasAttribute('disabled'))).toBe(true);
    // Pressed all the same: nothing is picked.
    rest[0].click();
    expect(items().filter((n) => n.getAttribute('aria-checked') === 'true')).toHaveLength(8);
    expect(items()[8].getAttribute('aria-checked')).toBe('false');
    // The arrows still reach them, so the list can be walked to its end.
    items()[7].focus();
    d.key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items()[8]);
    d.key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items()[10]);
    // One let go: the rest are live again.
    items()[0].click();
    expect(items().filter((n) => n.getAttribute('aria-disabled') === 'true')).toHaveLength(0);
    // The stylesheet dims them and keeps the hover light off, as it does a menu item that cannot be used.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.pick-item\[aria-disabled="true"\] \{[^}]*opacity: 0\.55;/);
    expect(css).toMatch(/\.pick-item\[aria-disabled="true"\]:hover \{[^}]*background: none;/);
  });
});

describe('a double click on a chip’s Remove (×)', () => {
  /** The second click of a double click: the browser counts it (detail 2) and it lands where the pointer is, on whatever stands there after the first click's redraw. */
  const secondClick = (node) => node.dispatchEvent(new CustomEvent('click', { bubbles: true, cancelable: true, detail: 2 }));

  it('removes one file from the message box, not the next one too as the chips reflow under the pointer', async () => {
    const { dom: d } = await boot();
    const { createComposer } = await import('../src/ui/composer.js');
    vi.spyOn(store, 'uploadFor').mockImplementation(async (conv, file) => ({ id: `f-${file.name}`, ...file }));
    const box = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1', draftKey: `${REF}:c1` });
    document.body.append(box.el);
    const input = box.el.querySelector('input[type="file"]');
    input.files = [{ name: 'a.pdf', size: 10, type: 'application/pdf' }, { name: 'b.pdf', size: 20, type: 'application/pdf' }, { name: 'c.pdf', size: 30, type: 'application/pdf' }];
    input.dispatchEvent(new Event('change'));
    await d.tick(6);
    const names = () => [...box.el.querySelectorAll('.chip .chip-name')].map((n) => n.textContent);
    expect(names()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    // The first click takes a.pdf; the chips close up, and the second click of the double lands on b.pdf's ×.
    box.el.querySelector('.chip button[aria-label="Remove a.pdf"]').click();
    expect(names()).toEqual(['b.pdf', 'c.pdf']);
    secondClick(box.el.querySelector('.chip button[aria-label="Remove b.pdf"]'));
    expect(names()).toEqual(['b.pdf', 'c.pdf']);
    // A deliberate single click on it, later, still removes it; so does the keyboard (a key's click counts nothing).
    box.el.querySelector('.chip button[aria-label="Remove b.pdf"]').click();
    expect(names()).toEqual(['c.pdf']);
    box.el.querySelector('.chip button[aria-label="Remove c.pdf"]').dispatchEvent(new CustomEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    expect(names()).toEqual([]);
    box.destroy();
  });

  it('removes one person from the picker of a new message, not the next one too', async () => {
    const { dom: d } = await boot();
    store.ws.members.u4 = { role: 'member', name: 'Cai Duo', username: 'cai', color: 4 };
    const { newDmDialog } = await import('../src/ui/dialogs.js');
    newDmDialog();
    await d.tick(1);
    const items = () => [...document.querySelectorAll('.pick-list[aria-label="People"] .pick-item')];
    for (const it of items()) it.click();
    const chips = () => [...document.querySelectorAll('.chips .chip')].map((c) => c.firstChild.textContent);
    expect(chips()).toEqual(['Ana Rocha', 'Ben Ito', 'Cai Duo']);
    document.querySelector('.chips .chip button[aria-label="Remove Ana Rocha"]').click();
    expect(chips()).toEqual(['Ben Ito', 'Cai Duo']);
    secondClick(document.querySelector('.chips .chip button[aria-label="Remove Ben Ito"]'));
    expect(chips()).toEqual(['Ben Ito', 'Cai Duo']);
    document.querySelector('.chips .chip button[aria-label="Remove Ben Ito"]').click();
    expect(chips()).toEqual(['Cai Duo']);
  });
});

describe('a message scheduled with Send later while the conversation was being left', () => {
  /** A box on #general whose Send later request is held until answered here, and a second box opened on the same conversation. */
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
    // The reader leaves the conversation while the worker answers: the words go into the draft, as they do whenever a box goes.
    a.destroy();
    a.el.remove();
    expect(getDraft(key)).toMatchObject({ text: 'later' });
    const b = open();
    expect(b.textarea.value).toBe('later');
    return { d, b, answer: () => answer({}), getDraft, key };
  }

  it('leaves the box opened next on the conversation empty once the message is scheduled, rather than showing the scheduled words as unsent', async () => {
    const { d, b, answer, getDraft, key } = await scheduling();
    answer();
    await d.tick(3);
    expect(b.textarea.value).toBe('');
    expect(b.el.querySelectorAll('.chip')).toHaveLength(0);
    expect(b.el.querySelector('.send-btn').disabled).toBe(true);
    expect(getDraft(key)).toBeNull();
    b.destroy();
  });

  it('keeps what the reader typed into that box meanwhile', async () => {
    const { d, b, answer, getDraft, key } = await scheduling();
    d.type(b.textarea, 'later, and something else');
    answer();
    await d.tick(3);
    expect(b.textarea.value).toBe('later, and something else');
    b.destroy();
    expect(getDraft(key)).toMatchObject({ text: 'later, and something else' });
  });
});

describe('files dragged over the conversation, not over the message box itself', () => {
  const drag = (type, target, files) => {
    const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: { types: ['Files'], files, items: undefined } });
    target.dispatchEvent(e);
    return e;
  };
  const files = [{ name: 'deck.pdf', size: 10, type: 'application/pdf' }];

  it('light the box as they pass over the messages and land in it when let go there, once; a drop into the box itself still lands once', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'uploadFor').mockImplementation(async (conv, file) => ({ id: `f-${file.name}`, ...file }));
    Object.assign(store.ws.channels.c1, { createdBy: 'u2', createdAt: 1_700_000_000_000 });
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const box = view.el.querySelector('.composer');
    const list = view.el.querySelector('.msg-list');
    const chips = () => [...view.el.querySelectorAll('.chip .chip-name')].map((n) => n.textContent);
    // Over the messages: the drop is claimed (the browser would otherwise open the file in the app's place) and the box lights.
    expect(drag('dragover', list, files).defaultPrevented).toBe(true);
    expect(box.style.borderColor).toBe('var(--accent)');
    // Let go over the messages: into the box.
    expect(drag('drop', list, files).defaultPrevented).toBe(true);
    await d.tick(3);
    expect(chips()).toEqual(['deck.pdf']);
    expect(box.style.borderColor).toBe('');
    // Into the box itself, as before: once, not once by the box and once by the column.
    drag('drop', view.el.querySelector('.composer-wrap textarea'), [{ name: 'notes.txt', size: 5, type: 'text/plain' }]);
    await d.tick(3);
    expect(chips()).toEqual(['deck.pdf', 'notes.txt']);
    // Leaving the column takes the light off the box.
    drag('dragover', list, files);
    expect(box.style.borderColor).toBe('var(--accent)');
    view.el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null }));
    expect(box.style.borderColor).toBe('');
    view.destroy();
  });

  it('stay inert over a channel the reader has not joined (no box to take them)', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    store.ws.channels.c3 = { id: 'c3', name: 'ops', count: 2, createdBy: 'u2', createdAt: 1_700_000_000_000 };
    Object.assign(store.conv('c3'), { loaded: true, seq: 1, hasMore: false, messages: [message(1)] });
    const view = createConversationView('c3', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    expect(view.el.querySelector('.composer')).toBeNull();
    expect(drag('dragover', view.el.querySelector('.msg-list'), files).defaultPrevented).toBe(false);
    expect(drag('drop', view.el.querySelector('.msg-list'), files).defaultPrevented).toBe(false);
    view.destroy();
  });

  it('land in the reply box when let go over a thread’s replies', async () => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'uploadFor').mockImplementation(async (conv, file) => ({ id: `f-${file.name}`, ...file }));
    const root = { ...message(2), replyCount: 1 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 2, hasMore: false, messages: [message(1), root] });
    Object.assign(store.conv('c1_t2'), { loaded: true, seq: 1, hasMore: false, messages: [message(1, 'u3')] });
    store.act.c.c1 = { s: 2 };
    const panel = document.createElement('section');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 2, onClose() {} });
    await d.tick(3);
    const replies = panel.querySelector('.msg-list');
    expect(drag('dragover', replies, files).defaultPrevented).toBe(true);
    expect(panel.querySelector('.composer').style.borderColor).toBe('var(--accent)');
    drag('drop', replies, files);
    await d.tick(3);
    expect([...panel.querySelectorAll('.chip .chip-name')].map((n) => n.textContent)).toEqual(['deck.pdf']);
    thread.destroy();
  });
});

describe('the word under a channel name field after an empty name, once the name is filled in', () => {
  /** Submit the dialog's form; the first visible error under a field, or none. */
  const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const shownError = (form) => [...form.querySelectorAll('.field-error')].find((n) => !n.hidden)?.textContent;

  it('comes off when the save fails for another reason (the network), rather than standing over a good name beside the toast, in Edit channel', async () => {
    const { dom: d, api } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const { ApiError } = await import('../src/lib/api.js');
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    const update = vi.spyOn(api, 'updateChannel').mockRejectedValue(new ApiError(0, 'network', 'Network down'));
    const { editChannelDialog } = await import('../src/ui/dialogs.js');
    editChannelDialog(store.ws.channels.c2);
    await d.tick(1);
    const form = document.querySelector('form');
    const name = form.querySelector('input.input');
    d.type(name, '!!!');
    submit(form);
    expect(shownError(form)).toBe('Give the channel a name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(update).not.toHaveBeenCalled();
    d.type(name, 'design');
    submit(form);
    await d.tick(4);
    expect(update).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Network down', { icon: 'alert' });
    expect(shownError(form)).toBeUndefined();
    expect(name.getAttribute('aria-invalid')).toBe('false');
    // A problem with the name itself still lands under it.
    update.mockRejectedValue(new ApiError(409, 'exists', 'There is already a channel called #design'));
    submit(form);
    await d.tick(4);
    expect(shownError(form)).toBe('There is already a channel called #design');
  });

  it('and in Create a channel', async () => {
    const { dom: d, api } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const { ApiError } = await import('../src/lib/api.js');
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    const create = vi.spyOn(api, 'createChannel').mockRejectedValue(new ApiError(0, 'network', 'Network down'));
    const { createChannelDialog } = await import('../src/ui/dialogs.js');
    createChannelDialog();
    await d.tick(1);
    const form = document.querySelector('form');
    const name = form.querySelector('input.input');
    submit(form);
    expect(shownError(form)).toBe('Give the channel a name');
    d.type(name, 'design');
    submit(form);
    await d.tick(4);
    expect(create).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Network down', { icon: 'alert' });
    expect(shownError(form)).toBeUndefined();
  });
});

describe('the category tabs of the emoji picker', () => {
  it('are one tab stop, the arrows stepping between them and picking, Home and End going to the ends, as on any tab strip', async () => {
    const { dom: d } = await boot();
    const { openEmojiPicker } = await import('../src/ui/emojipicker.js');
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const pop = openEmojiPicker(anchor, { onPick: vi.fn() });
    await d.tick(1);
    const tabs = () => [...document.querySelectorAll('.emoji-tab')];
    expect(tabs().length).toBeGreaterThan(3);
    // One stop: the selected tab alone is in the Tab order.
    const selected = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(tabs()[0]);
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(tabs().map((t) => (t === selected() ? '0' : '-1')));
    tabs()[0].focus();
    expect(d.key(document.activeElement, 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tabs()[1]);
    // The arrow picks as it moves: the section in view is the tab's, and the stop follows.
    expect(selected()).toBe(tabs()[1]);
    expect(tabs()[1].getAttribute('tabindex')).toBe('0');
    expect(tabs()[0].getAttribute('tabindex')).toBe('-1');
    d.key(document.activeElement, 'End');
    expect(document.activeElement).toBe(tabs()[tabs().length - 1]);
    expect(selected()).toBe(tabs()[tabs().length - 1]);
    d.key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(tabs()[0]);
    // Round at the ends.
    d.key(document.activeElement, 'ArrowLeft');
    expect(document.activeElement).toBe(tabs()[tabs().length - 1]);
    d.key(document.activeElement, 'ArrowRight');
    expect(document.activeElement).toBe(tabs()[0]);
    // A modified arrow is a shortcut's and passes.
    expect(d.key(document.activeElement, 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tabs()[0]);
    pop.close();
  });
});
