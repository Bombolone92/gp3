/**
 * Conversation UI (review pass 27), driven in node through
 * tests/helpers/dom.js as the pass-19 to pass-26 files are: a fresh DOM and
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

/** A message list on #general holding `messages`, landed and marked read (the store's read is a spy). */
async function listOn(messages, { d }) {
  const { createMessageList } = await import('../src/ui/messagelist.js');
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  const last = messages[messages.length - 1].seq;
  Object.assign(store.conv('c1'), { loaded: true, seq: last, hasMore: false, messages });
  store.act.c.c1 = { s: last };
  const list = createMessageList({ convId: 'c1' });
  document.body.append(list.el);
  await d.tick(5);
  return list;
}

describe('the keyboard on a control whose press takes its own group out of the row', () => {
  it('"Remove preview" pressed from the keyboard lands on the message, not on whatever control now stands at its place in the row', async () => {
    const { dom: d } = await boot();
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (init.method === 'DELETE' && new URL(url).pathname.endsWith('/messages/3/unfurl')) return json({ ok: true });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const list = await listOn([message(1), message(2), message(3, 'u-me', { unfurl: { kind: 'link', url: 'https://example.com/a', site: 'example.com', title: 'An example' } })], { d });
    const row = () => list.el.querySelector('.msg[data-seq="3"]');
    const remove = row().querySelector('.unfurl-remove');
    expect(remove).toBeTruthy();
    // Reached with Tab and the arrows: the row, then its Remove preview.
    row().focus();
    remove.focus();
    expect(document.activeElement).toBe(remove);
    remove.click();
    await d.tick(10);
    expect(row().querySelector('.unfurl')).toBeNull();
    // The card is gone, and its button with it; the row itself takes the
    // keyboard. By its place among the row's controls, it landed on the
    // hover bar's "Reply in thread" (or a quick reaction), a Space away from
    // pressing it.
    expect(document.activeElement).toBe(row());
    list.destroy();
  });

  it('a reaction pill that goes with the press hands the keyboard to the next pill, and the last pill to the message', async () => {
    const { dom: d } = await boot();
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (init.method === 'POST' && new URL(url).pathname.endsWith('/reactions')) return json({ ok: true });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const list = await listOn([message(1), message(2), message(3, 'u2', { reactions: { thumbsup: { 'u-me': 1 }, eyes: { 'u-me': 1, u3: 1 } } })], { d });
    const row = () => list.el.querySelector('.msg[data-seq="3"]');
    const pills = () => [...row().querySelectorAll('.reaction:not(.reaction-add)')];
    expect(pills()).toHaveLength(2);
    // The first pill is the reader's alone: pressed, it goes, and the pill now first takes the keyboard.
    row().focus();
    pills()[0].focus();
    pills()[0].click();
    await d.tick(10);
    expect(pills()).toHaveLength(1);
    expect(document.activeElement).toBe(pills()[0]);
    // The reader's mark on the last pill comes off: the pill stays (Ben's), and keeps the keyboard.
    pills()[0].click();
    await d.tick(10);
    expect(pills()).toHaveLength(1);
    expect(pills()[0].getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(pills()[0]);
    list.destroy();
  });

  it('the hover bar\'s Add reaction keeps the keyboard through a redraw, rather than handing it to the reactions row\'s "+", which wears the same label', async () => {
    const { dom: d } = await boot();
    const list = await listOn([message(1), message(2), message(3, 'u2', { reactions: { eyes: { u3: 1 } } })], { d });
    const row = () => list.el.querySelector('.msg[data-seq="3"]');
    const barAdd = () => row().querySelector('.msg-actions [aria-label="Add reaction"]');
    expect(row().querySelector('.reactions .reaction-add')).toBeTruthy();
    row().focus();
    barAdd().focus();
    expect(document.activeElement).toBe(barAdd());
    // A teammate's post redraws the list.
    const m = message(4);
    store.conv('c1').messages.push(m);
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [m] });
    await d.tick(10);
    expect(document.activeElement).toBe(barAdd());
    list.destroy();
  });
});

describe('a reader scrolled up into the history when the list is drawn again', () => {
  /**
   * A layout for the list, since the fake DOM has none: every message row is
   * 40px tall, 70px with a reactions row under it; the scroller shows 200px
   * of the list from its `scrollTop`. Rows are measured from their place
   * among the rows, so a fresh drawing measures as the layout would.
   */
  function layOut(list) {
    const scroller = list.scroller;
    const rowsOf = () => [...list.el.querySelectorAll('.msg-list .msg')];
    const heightOf = (r) => 40 + (r.querySelector('.reactions') ? 30 : 0);
    const topOf = (row) => {
      let y = 0;
      for (const r of rowsOf()) {
        if (r === row) return y;
        y += heightOf(r);
      }
      return y;
    };
    const total = () => rowsOf().reduce((n, r) => n + heightOf(r), 0);
    const proto = Object.getPrototypeOf(scroller);
    const real = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      if (this === scroller) return { top: 0, bottom: 200, left: 0, right: 600, width: 600, height: 200, x: 0, y: 0 };
      if (this.classList.contains('msg') && this.closest('.msg-list')) {
        const top = topOf(this) - scroller.scrollTop;
        return { top, bottom: top + heightOf(this), left: 0, right: 600, width: 600, height: heightOf(this), x: 0, y: top };
      }
      return real.call(this);
    };
    Object.defineProperty(scroller, 'scrollHeight', { get: total, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 200, configurable: true });
    return { restore: () => { proto.getBoundingClientRect = real; }, total };
  }

  it('keeps the message at the top of the viewport where it was when a change above it (a reaction on a message scrolled past) makes the rows above taller', async () => {
    const { dom: d } = await boot();
    const messages = Array.from({ length: 20 }, (_, i) => message(i + 1));
    const list = await listOn(messages, { d });
    const { restore, total } = layOut(list);
    try {
      const scroller = list.scroller;
      expect(total()).toBe(800);
      // Landed at the bottom; the reader scrolls up to read message 11 at the top of the viewport.
      scroller.scrollTop = 800 - 200;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      await d.tick(5);
      const topRow = () => list.el.querySelector('.msg-list .msg[data-seq="11"]').getBoundingClientRect().top;
      expect(topRow()).toBe(0);
      // Ana reacts to message 3, above: its row grows by a reactions row, and the list is drawn again whole.
      store.conv('c1').messages[2].reactions = { thumbsup: { u2: 1 } };
      store.emit('messages', { conv: 'c1', reason: 'range' });
      await d.tick(5);
      expect(total()).toBe(830);
      expect(topRow()).toBe(0);
      expect(scroller.scrollTop).toBe(430);
      // And a poll's redraw of the workspace, with nothing changed, moves nothing.
      store.emit('workspace');
      await d.tick(5);
      expect(scroller.scrollTop).toBe(430);
      // The reaction comes off again above (the rows above shrink back): still in place.
      store.conv('c1').messages[2].reactions = {};
      store.emit('messages', { conv: 'c1', reason: 'range' });
      await d.tick(5);
      expect(scroller.scrollTop).toBe(400);
      expect(topRow()).toBe(0);
    } finally {
      restore();
      list.destroy();
    }
  });

  it('a reader at the bottom stays pinned to it, as before', async () => {
    const { dom: d } = await boot();
    const messages = Array.from({ length: 20 }, (_, i) => message(i + 1));
    const list = await listOn(messages, { d });
    const { restore } = layOut(list);
    try {
      const scroller = list.scroller;
      scroller.scrollTop = 600;
      scroller.dispatchEvent(new Event('scroll'));
      await d.tick(5);
      store.conv('c1').messages[2].reactions = { thumbsup: { u2: 1 } };
      store.emit('messages', { conv: 'c1', reason: 'range' });
      await d.tick(20);
      expect(scroller.scrollTop).toBe(830);
    } finally {
      restore();
      list.destroy();
    }
  });

  it('a page of older messages landing above still leaves the viewport where it was, as it did', async () => {
    const { dom: d } = await boot();
    const messages = Array.from({ length: 20 }, (_, i) => message(i + 6));
    const list = await listOn(messages, { d });
    const { restore, total } = layOut(list);
    try {
      const scroller = list.scroller;
      store.conv('c1').hasMore = true;
      scroller.scrollTop = 600;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      await d.tick(5);
      const topRow = () => list.el.querySelector('.msg-list .msg[data-seq="16"]').getBoundingClientRect().top;
      expect(topRow()).toBe(0);
      // Five older messages land at the top (the store prepends them and says so).
      store.conv('c1').messages.unshift(...[1, 2, 3, 4, 5].map((n) => message(n)));
      store.emit('messages', { conv: 'c1', reason: 'older' });
      await d.tick(5);
      expect(total()).toBe(1000);
      expect(scroller.scrollTop).toBe(600);
      expect(topRow()).toBe(0);
    } finally {
      restore();
      list.destroy();
    }
  });
});

describe('a reader scrolled up in a long thread when a reply above them changes', () => {
  it('keeps their place too: the thread panel draws its replies through the same list', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    const { renderMessage } = await import('../src/ui/message.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const root = message(5, 'u3');
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [root] });
    const replies = Array.from({ length: 20 }, (_, i) => message(i + 1));
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 20, hasMore: false, messages: replies });
    store.act.c.c1 = { s: 5 };
    // As panel.js builds it: the root drawn at the head of the thread's own list.
    const header = () => renderMessage(root, { convId: 'c1', inThread: true, isRoot: true, rootSeq: 5, parentConv: 'c1', membersByUsername: store.membersByUsername() });
    const list = createMessageList({ convId: 'c1_t5', inThread: true, rootSeq: 5, parentConv: 'c1', header });
    document.body.append(list.el);
    await d.tick(5);
    const scroller = list.scroller;
    const rowsOf = () => [...list.el.querySelectorAll('.msg-list .msg')];
    const heightOf = (r) => 40 + (r.querySelector('.reactions') ? 30 : 0);
    const topOf = (row) => { let y = 0; for (const r of rowsOf()) { if (r === row) return y; y += heightOf(r); } return y; };
    const proto = Object.getPrototypeOf(scroller);
    const real = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      if (this === scroller) return { top: 0, bottom: 200, left: 0, right: 400, width: 400, height: 200, x: 0, y: 0 };
      if (this.classList.contains('msg') && this.closest('.msg-list')) {
        const top = topOf(this) - scroller.scrollTop;
        return { top, bottom: top + heightOf(this), left: 0, right: 400, width: 400, height: heightOf(this), x: 0, y: top };
      }
      return real.call(this);
    };
    Object.defineProperty(scroller, 'scrollHeight', { get: () => rowsOf().reduce((n, r) => n + heightOf(r), 0), configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 200, configurable: true });
    try {
      expect(rowsOf()).toHaveLength(21); // the root, then twenty replies
      scroller.scrollTop = 640;
      scroller.dispatchEvent(new Event('scroll'));
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new Event('scroll'));
      await d.tick(5);
      // Reply 10 stands at the top of the viewport (the root and nine replies above it).
      const topRow = () => list.el.querySelector('.msg-list .msg:not(.thread-root)[data-seq="10"]').getBoundingClientRect().top;
      expect(topRow()).toBe(0);
      // Ben reacts to reply 2, above.
      store.conv('c1_t5').messages[1].reactions = { thumbsup: { u3: 1 } };
      store.emit('messages', { conv: 'c1_t5', reason: 'range' });
      await d.tick(5);
      expect(scroller.scrollTop).toBe(430);
      expect(topRow()).toBe(0);
      // And a reaction on the root itself, at the head of the thread (the panel redraws the list for it).
      root.reactions = { eyes: { u3: 1 } };
      list.refresh();
      await d.tick(5);
      expect(scroller.scrollTop).toBe(460);
      expect(topRow()).toBe(0);
    } finally {
      proto.getBoundingClientRect = real;
      list.destroy();
    }
  });
});

describe('a message\'s menu standing open while the list is drawn again under it', () => {
  it('the fresh "More actions" says the menu is open, and a press on it closes the menu rather than opening a second', async () => {
    const { dom: d } = await boot();
    const list = await listOn([message(1), message(2), message(3)], { d });
    const row = () => list.el.querySelector('.msg[data-seq="3"]');
    const more = () => row().querySelector('.msg-actions [aria-label="More actions"]');
    row().focus();
    more().focus();
    more().click();
    await d.tick(5);
    const menu = () => document.querySelector('.menu[role="menu"]');
    expect(menu()).toBeTruthy();
    expect(more().getAttribute('aria-expanded')).toBe('true');
    const opened = more();
    // A teammate's post redraws the list under the open menu.
    const m = message(4);
    store.conv('c1').messages.push(m);
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [m] });
    await d.tick(10);
    expect(more()).not.toBe(opened);
    expect(row().classList.contains('menu-open')).toBe(true);
    expect(menu()).toBeTruthy();
    // The button drawn in the opener's place says what the opener said.
    expect(more().getAttribute('aria-expanded')).toBe('true');
    // Pressed (the pointer first, then its click, as a browser sends them): the menu closes, and no second menu opens in its place.
    more().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    more().click();
    await d.tick(5);
    expect(menu()).toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('false');
    expect(row().classList.contains('menu-open')).toBe(false);
    // And the keyboard is back on the button drawn in the opener's place.
    expect(document.activeElement).toBe(more());
    list.destroy();
  });

  it('the same for the conversation header\'s More, which the workspace poll draws anew under its open menu', async () => {
    const { dom: d } = await boot();
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3 };
    const { createConversationView } = await import('../src/ui/conversation.js');
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    const more = () => view.el.querySelector('.conv-header [aria-label="More"]');
    const menu = () => document.querySelector('.menu[role="menu"]');
    more().focus();
    more().click();
    await d.tick(5);
    expect(menu()).toBeTruthy();
    const opened = more();
    store.emit('workspace');
    await d.tick(5);
    expect(more()).not.toBe(opened);
    expect(menu()).toBeTruthy();
    expect(more().getAttribute('aria-expanded')).toBe('true');
    more().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    more().click();
    await d.tick(5);
    expect(menu()).toBeNull();
    expect(more().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more());
    view.destroy();
  });
});

describe('a reaction pill as a screen reader hears it', () => {
  it('is named by the emoji, how many reacted and who, pressed when the reader is one of them, and says so afresh when they toggle it; the "+" beside the pills is a button of the group', async () => {
    const { dom: d } = await boot();
    const { emojiLabel } = await import('../src/lib/emoji.js');
    globalThis.puter.workers.exec = async (url, init = {}) => {
      if (init.method === 'POST' && new URL(url).pathname.endsWith('/reactions')) return json({ ok: true });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const list = await listOn([message(1), message(2, 'u2', { reactions: { eyes: { u3: 1, 'u-me': 1 }, tada: { u3: 1 } } })], { d });
    const row = () => list.el.querySelector('.msg[data-seq="2"]');
    const pill = (i) => row().querySelectorAll('.reaction:not(.reaction-add)')[i];
    const eyes = emojiLabel('eyes');
    expect(row().querySelector('.reactions').getAttribute('role')).toBe('group');
    expect(pill(0).getAttribute('aria-label')).toBe(`${eyes}, 2 reactions: Ben Ito, You`);
    expect(pill(0).getAttribute('aria-pressed')).toBe('true');
    expect(pill(0).getAttribute('title')).toBe(`${eyes}: Ben Ito, You`); // the tooltip as before (pass 19 caps it at three names)
    expect(pill(1).getAttribute('aria-label')).toBe(`${emojiLabel('tada')}, 1 reaction: Ben Ito`);
    expect(pill(1).getAttribute('aria-pressed')).toBe('false');
    // The reader takes their eyes off: the pill drawn anew says one fewer, and is no longer pressed.
    pill(0).click();
    await d.tick(10);
    expect(pill(0).getAttribute('aria-label')).toBe(`${eyes}, 1 reaction: Ben Ito`);
    expect(pill(0).getAttribute('aria-pressed')).toBe('false');
    // And back on.
    pill(0).click();
    await d.tick(10);
    expect(pill(0).getAttribute('aria-label')).toBe(`${eyes}, 2 reactions: Ben Ito, You`);
    expect(pill(0).getAttribute('aria-pressed')).toBe('true');
    // The "+" is a plain button in the group's Tab order, named for what it does.
    const add = row().querySelector('.reactions .reaction-add');
    expect(add.getAttribute('aria-label')).toBe('Add reaction');
    expect(add.tabIndex).toBe(0);
    expect(add.hasAttribute('aria-pressed')).toBe(false);
    list.destroy();
  });
});

describe('the media viewer walked with the keyboard', () => {
  it('names each picture with its place among the others, steps with the arrows, Home and End, and hands an arrow that goes disabled under the keyboard to the other', async () => {
    const { dom: d } = await boot();
    const files = await import('../src/lib/files.js');
    vi.spyOn(files, 'attachmentUrl').mockImplementation(async (ref, id) => {
      if (id === 'c') throw Object.assign(new Error('busy'), { status: 429 });
      return `blob:${id}`;
    });
    const { openMediaViewer } = await import('../src/ui/mediaviewer.js');
    const item = (id, name) => ({ file: { id, name, type: 'image/png', size: 10 }, ref: REF, author: { name: 'Ana', uuid: 'u2' }, ts: 1_700_000_000_000 });
    const modal = openMediaViewer({ items: [item('a', 'one.png'), item('b', 'two.png'), item('c', 'three.png')], index: 0 });
    // The modal layer is mocked flat here: its root wears the class the viewer reads to know it is the dialog on top.
    modal.root.classList.add('modal-root');
    await d.tick(3);
    const root = modal.panel;
    const img = root.querySelector('.viewer-img');
    const prev = root.querySelector('.viewer-nav.prev');
    const next = root.querySelector('.viewer-nav.next');
    const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(root.getAttribute('aria-label')).toBe('one.png, 1 of 3');
    expect(root.querySelector('.viewer-count').textContent).toBe('1 of 3');
    expect(img.getAttribute('src')).toBe('blob:a');
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    press('ArrowRight');
    await d.tick(3);
    expect(root.getAttribute('aria-label')).toBe('two.png, 2 of 3');
    expect(img.getAttribute('src')).toBe('blob:b');
    expect(prev.disabled).toBe(false);
    // End, with the keyboard on Next: the last picture, and Next going disabled hands the keyboard to Previous rather than to the page.
    next.focus();
    press('End');
    await d.tick(3);
    expect(root.getAttribute('aria-label')).toBe('three.png, 3 of 3');
    expect(next.disabled).toBe(true);
    expect(document.activeElement).toBe(prev);
    // This picture's bytes could not be had: the line says so with Try again and Download, and the arrows still walk on from it.
    const status = root.querySelector('.viewer-status');
    expect(status.textContent).toContain('Could not load the image');
    expect([...status.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again', 'Download']);
    press('Home');
    await d.tick(3);
    expect(root.getAttribute('aria-label')).toBe('one.png, 1 of 3');
    expect(img.getAttribute('src')).toBe('blob:a');
    expect(status.classList.contains('loading')).toBe(true); // the failure line gave way to the wait for the first picture
    // Previous going disabled under the keyboard hands it to Next.
    expect(document.activeElement).toBe(next);
    modal.close();
    await d.tick(2);
  });
});

describe('a fenced code block, which scrolls sideways for a wide line', () => {
  it('is a tab stop, so the keyboard can scroll it, with its focus ring drawn inside the block as the block\'s other controls draw theirs', async () => {
    await boot();
    const { decorateCodeBlock } = await import('../src/ui/message.js');
    const text = document.createElement('div');
    text.className = 'msg-text';
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.dataset.lang = 'js';
    const code = document.createElement('code');
    code.textContent = 'const wide = 1;';
    pre.append(code);
    text.append(pre);
    document.body.append(text);
    decorateCodeBlock(pre);
    expect(text.querySelector('.code-wrap pre.code-block')).toBe(pre);
    expect(pre.getAttribute('tabindex')).toBe('0');
    // Its buttons keep theirs.
    expect(text.querySelector('.code-copy').tabIndex).toBe(0);
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // The rule that draws the block's buttons' rings inside their box draws the block's the same way.
    const rules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const inset = rules.find((r) => /\.code-copy:focus-visible/.test(r.selector) && /outline-offset:\s*-2px/.test(r.body));
    expect(inset).toBeTruthy();
    expect(inset.selector).toMatch(/\.code-block:focus-visible/);
  });

  it('holding the keyboard, keeps the list\'s arrows for its own scrolling: they step between messages only from a message itself', async () => {
    const { dom: d } = await boot();
    const list = await listOn([message(1), message(2), message(3)], { d });
    const row = list.el.querySelector('.msg[data-seq="2"]');
    // A block as the renderer leaves it in a row (the fake DOM parses no markup, so it is put there by hand).
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.setAttribute('tabindex', '0');
    row.querySelector('.msg-text').append(pre);
    pre.focus();
    expect(document.activeElement).toBe(pre);
    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    pre.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(pre);
    // From the row itself, Down steps to the next message, as before.
    row.focus();
    const f = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    row.dispatchEvent(f);
    expect(f.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(list.el.querySelector('.msg[data-seq="3"]'));
    list.destroy();
  });
});

describe('the emoji picker\'s grid in the Tab order', () => {
  it('holds one stop, the cell last under the keyboard or the first, so Tab from the search box reaches the emoji before the categories; the arrows move the stop with the keyboard', async () => {
    const { dom: d } = await boot();
    const { loadEmoji } = await import('../src/lib/emoji.js');
    await loadEmoji();
    const { openEmojiPicker } = await import('../src/ui/emojipicker.js');
    const { focusables } = await import('../src/ui/dom.js');
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const pop = openEmojiPicker(anchor, { onPick() {} });
    await d.tick(2);
    const node = pop.node;
    const search = node.querySelector('.emoji-search');
    const cells = () => [...node.querySelectorAll('.emoji-cell')];
    const stops = () => focusables(node);
    // Search and the tone button in the head, the selected category tab, then one cell of the grid (the grid had no stop at all).
    expect(stops().map((n) => n.className.split(' ')[0])).toEqual(['emoji-search', 'emoji-tone', 'emoji-tab', 'emoji-cell']);
    expect(cells().filter((c) => c.getAttribute('tabindex') === '0')).toEqual([cells()[0]]);
    // Down from the search box lands on the first cell (as before); Right moves on, and the stop follows.
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cells()[0]);
    cells()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cells()[1]);
    expect(cells().filter((c) => c.getAttribute('tabindex') === '0')).toEqual([cells()[1]]);
    expect(stops()[3]).toBe(cells()[1]);
    // A search draws the grid anew: its first cell is the stop again.
    search.focus();
    search.value = 'thumb';
    search.dispatchEvent(new Event('input'));
    expect(cells().length).toBeGreaterThan(0);
    expect(cells().filter((c) => c.getAttribute('tabindex') === '0')).toEqual([cells()[0]]);
    pop.close();
    await d.tick(2);
  });
});

describe('the times shown beside a message\'s own stamp', () => {
  it('"Last reply" under a thread\'s line and the times of a pinned message are <time> elements, the moment in datetime and the full date in the title', async () => {
    const { dom: d } = await boot();
    const { fullDateTime } = await import('../src/lib/time.js');
    const at = 1_700_000_500_000;
    const list = await listOn([message(1), message(2, 'u2', { replyCount: 2, lastReplyAt: at })], { d });
    const when = list.el.querySelector('.msg[data-seq="2"] .thread-link .thread-when');
    expect(when.textContent).toMatch(/^Last reply \S/);
    const t = when.querySelector('time');
    expect(t).toBeTruthy();
    expect(t.getAttribute('datetime')).toBe(new Date(at).toISOString());
    expect(t.getAttribute('title')).toBe(fullDateTime(at));
    // The messages' own stamps, as they have been: in the head of the first, in the gutter of the second (which continues it).
    const own = list.el.querySelector('.msg[data-seq="1"] time.msg-time');
    expect(own.getAttribute('datetime')).toBe(new Date(1_700_000_000_001).toISOString());
    expect(own.getAttribute('title')).toBe(fullDateTime(1_700_000_000_001));
    const gutter = list.el.querySelector('.msg[data-seq="2"] time.msg-time-gutter');
    expect(gutter.getAttribute('datetime')).toBe(new Date(1_700_000_000_002).toISOString());
    expect(gutter.getAttribute('title')).toBe(fullDateTime(1_700_000_000_002));
    list.destroy();
    // A pin's row: the message's time, and when it was pinned.
    const { renderPinList } = await import('../src/ui/pins.js');
    const pinned = 1_700_000_600_000;
    const pins = renderPinList('c1', [{ seq: 2, by: 'u2', ts: pinned, message: message(2) }]);
    document.body.append(pins);
    const head = pins.querySelector('.pin-head time');
    expect(head.getAttribute('datetime')).toBe(new Date(1_700_000_000_002).toISOString());
    expect(head.getAttribute('title')).toBe(fullDateTime(1_700_000_000_002));
    const meta = pins.querySelector('.pin-meta');
    expect(meta.textContent).toMatch(/^Pinned by Ana Rocha \S/);
    expect(meta.querySelector('time').getAttribute('datetime')).toBe(new Date(pinned).toISOString());
    expect(meta.querySelector('time').getAttribute('title')).toBe(fullDateTime(pinned));
  });
});

describe('words pasted into a message\'s edit box past the limit', () => {
  it('land whole (no maxlength to cut them without a word), a note says how far over, the box is marked invalid, and Save refuses them with the count', async () => {
    const { dom: d } = await boot();
    const { toast } = await import('../src/ui/toast.js');
    const calls = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      calls.push({ method: init.method, path: new URL(url).pathname });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const list = await listOn([message(1), message(2, 'u-me', { text: 'mine' })], { d });
    const { startInlineEdit } = await import('../src/ui/message.js');
    const row = list.el.querySelector('.msg[data-seq="2"]');
    expect(startInlineEdit(row)).toBe(true);
    const box = row.querySelector('.msg-edit-input');
    expect(box.hasAttribute('maxlength')).toBe(false);
    const note = row.querySelector('.msg-edit-over');
    const said = row.querySelector('.msg-edit-actions [role="status"]');
    expect(note.hidden).toBe(true);
    expect(box.getAttribute('aria-invalid')).toBe('false');
    // Six thousand characters pasted in.
    d.type(box, 'x'.repeat(6000));
    expect(box.value).toHaveLength(6000);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('2,000 over the 4,000 character limit');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(said.textContent).toBe('Message is 2,000 characters over the 4,000 character limit');
    // Typing on moves the count for the eye, and says nothing more.
    d.type(box, 'x'.repeat(6001));
    expect(note.textContent).toBe('2,001 over the 4,000 character limit');
    expect(said.textContent).toBe('Message is 2,000 characters over the 4,000 character limit');
    // Enter: refused with the count, nothing sent.
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await d.tick(3);
    expect(toast.mock.calls.some((c) => /up to 4,000 characters; this one is 6,001/.test(c[0]))).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(row.classList.contains('editing')).toBe(true);
    // Trimmed back under the limit: the note goes, and the status says so once.
    d.type(box, 'x'.repeat(10));
    expect(note.hidden).toBe(true);
    expect(box.getAttribute('aria-invalid')).toBe('false');
    expect(said.textContent).toBe('');
    list.destroy();
  });
});

describe('the stylesheets under a phone\'s on-screen keyboard', () => {
  it('let the column follow the viewport the browser reports (html and body at 100%, nothing at 100vh) and bound the fixed layers in dvh, so the composer rises with the keyboard and the list does not jump', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (f) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const base = read('base.css');
    const app = read('app.css');
    const components = read('components.css');
    const rule = (css, sel) => (css.match(new RegExp(`(^|\\}|;)\\s*${sel.replace(/[.\-[\]="]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')) || [])[2] || '';
    expect(rule(base, 'html')).toMatch(/height:\s*100%/);
    expect(rule(base, 'body')).toMatch(/height:\s*100%/);
    expect(rule(base, '.app')).toMatch(/flex:\s*1/);
    expect(rule(app, '.main')).toMatch(/min-height:\s*0/);
    expect(rule(app, '.msg-scroll')).toMatch(/overscroll-behavior:\s*contain/);
    // A 100vh is the viewport with the keyboard down: under it the composer sat behind the keyboard.
    for (const css of [base, app, components]) expect(css).not.toMatch(/100vh/);
    expect(rule(components, '.menu[role="menu"]')).toMatch(/max-height:\s*calc\(100dvh/);
    expect(rule(components, '.emoji-picker')).toMatch(/dvh/);
  });
});

describe('the words under a quote card saying where the message lives', () => {
  it('wrap inside the card at a phone\'s width, a channel name of forty letters with no break in it included (the stylesheet says so, as it does for the card\'s text)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel) => (css.match(new RegExp(`(^|\\}|;)\\s*${sel.replace(/[.\-]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')) || [])[2] || '';
    expect(rule('.msg-quote-text')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.msg-quote-src')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
