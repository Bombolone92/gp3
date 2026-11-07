/**
 * Conversation UI (lead, review pass 23), driven in node through
 * tests/helpers/dom.js as the pass-15 conversation file is: a fresh DOM and
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
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3, createdBy: 'u2', createdAt: 1_700_000_000_000 }, c2: { id: 'c2', name: 'random', count: 3 } },
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
const key = (node, k, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(e);
  return e;
};

describe('where the keyboard goes when an edit in place closes', () => {
  it('returns to the row for an edit opened from the row, and to the message box for one opened from it with ArrowUp', async () => {
    await boot();
    const { renderMessage, startInlineEdit } = await import('../src/ui/message.js');
    const msg = message(7, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const ctx = { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} };
    const row = renderMessage(msg, ctx);
    const box = document.createElement('textarea');
    document.body.append(row, box);
    // From the row (E, the menu): the row again.
    expect(startInlineEdit(row)).toBe(true);
    key(row.querySelector('.msg-edit-input'), 'Escape');
    expect(row.classList.contains('editing')).toBe(false);
    expect(document.activeElement).toBe(row);
    // From the message box: the box again, ready for the next words.
    box.focus();
    expect(startInlineEdit(row, { back: box })).toBe(true);
    expect(document.activeElement).toBe(row.querySelector('.msg-edit-input'));
    key(row.querySelector('.msg-edit-input'), 'Escape');
    expect(row.classList.contains('editing')).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('falls back to the row when the box the edit came from is gone', async () => {
    await boot();
    const { renderMessage, startInlineEdit } = await import('../src/ui/message.js');
    const msg = message(7, 'u-me');
    Object.assign(store.conv('c1'), { loaded: true, seq: 7, hasMore: false, messages: [msg] });
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    const box = document.createElement('textarea');
    document.body.append(row, box);
    expect(startInlineEdit(row, { back: box })).toBe(true);
    box.remove();
    key(row.querySelector('.msg-edit-input'), 'Escape');
    expect(document.activeElement).toBe(row);
  });

  it('ArrowUp in the conversation\'s empty box edits the last own message and Escape puts the keyboard back in the box, through a redraw of the list too', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2, 'u-me'), message(3)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const box = view.el.querySelector('.composer textarea');
    expect(box).toBeTruthy();
    box.focus();
    expect(key(box, 'ArrowUp').defaultPrevented).toBe(true);
    const editing = () => view.el.querySelector('.msg.editing');
    expect(editing()?.dataset.seq).toBe('2');
    expect(document.activeElement).toBe(editing().querySelector('.msg-edit-input'));
    // A teammate's post redraws the list under the edit: the box moves to
    // the row's replacement, and so does where it hands the keyboard back.
    store.conv('c1').messages.push(message(4));
    store.emit('messages', { conv: 'c1', reason: 'poll', added: [message(4)] });
    await d.tick(3);
    expect(editing()?.dataset.seq).toBe('2');
    const input = editing().querySelector('.msg-edit-input');
    expect(document.activeElement).toBe(input);
    key(input, 'Escape');
    expect(editing()).toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it('a saved edit opened with ArrowUp leaves the keyboard in the box as well', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(store, 'edit').mockImplementation(async (conv, seq, text) => {
      const m = store.conv(conv).messages.find((x) => x.seq === seq);
      m.text = text;
      m.editedAt = Date.now();
      store.emit('messages', { conv, reason: 'edit' });
    });
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2, 'u-me'), message(3)] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(3);
    const box = view.el.querySelector('.composer textarea');
    box.focus();
    key(box, 'ArrowUp');
    const input = view.el.querySelector('.msg.editing .msg-edit-input');
    input.value = 'm2, fixed';
    key(input, 'Enter');
    await d.tick(5);
    expect(view.el.querySelector('.msg.editing')).toBeNull();
    // The row's message goes along as the fourth argument (see store.edit's `shown`).
    expect(store.edit).toHaveBeenCalledWith('c1', 2, 'm2, fixed', expect.objectContaining({ seq: 2 }));
    expect(document.activeElement).toBe(box);
  });
});

describe('an edit standing open on a Threads view card while the card is drawn again', () => {
  /** The Threads view over one thread whose root is the reader's own, its replies already read. */
  async function openThreads() {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    const root = { seq: 1, user: 'u-me', ts: 1_700_000_000_001, text: 'root 1', kind: 'msg', replyCount: 1, attachments: [], mentions: [], reactions: {} };
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    // The channel's own window holds the root too, as it does once the channel has been opened.
    Object.assign(store.conv('c1'), { loaded: true, seq: 1, hasMore: false, messages: [{ ...root }] });
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    expect(card).toBeTruthy();
    return { d, v, card };
  }

  it('keeps the box, its words and the keyboard on the fresh row, for a reply landing and for a message landing in the channel', async () => {
    const { d, v, card } = await openThreads();
    const old = card.querySelector('.msg.thread-root');
    expect(old).toBeTruthy();
    old.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Edit message')).click();
    await d.tick(1);
    const input = old.querySelector('.msg-edit-input');
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    input.value = 'root 1, and more';
    // A reply lands in the thread: the card draws its rows anew under the edit.
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    const fresh = card.querySelector('.msg.thread-root');
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(old);
    const again = fresh.querySelector('.msg-edit-input');
    expect(again).toBeTruthy();
    expect(again.value).toBe('root 1, and more');
    expect(document.activeElement).toBe(again);
    // A message lands in the channel itself (the root's conversation): the card draws again, and the edit stands.
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    const third = card.querySelector('.msg.thread-root .msg-edit-input');
    expect(third).toBeTruthy();
    expect(third).not.toBe(again);
    expect(third.value).toBe('root 1, and more');
    expect(document.activeElement).toBe(third);
    // Escape lets the edit go, on the fresh row.
    d.key(third, 'Escape');
    expect(card.querySelector('.msg.editing')).toBeNull();
    expect(document.activeElement).toBe(card.querySelector('.msg.thread-root'));
    v.destroy();
  });

  it('says so and stops when the message was deleted under the edit', async () => {
    const { d, v, card } = await openThreads();
    const { toast } = await import('../src/ui/toast.js');
    const old = card.querySelector('.msg.thread-root');
    old.querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent.includes('Edit message')).click();
    await d.tick(1);
    old.querySelector('.msg-edit-input').value = 'root 1, and more';
    // Deleted by an admin meanwhile: the root stands as a tombstone in the channel.
    const m = store.conv('c1').messages.find((x) => x.seq === 1);
    Object.assign(m, { deleted: true, text: '' });
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    expect(card.querySelector('.msg.editing')).toBeNull();
    expect(toast).toHaveBeenCalledWith('That message was deleted while you were editing it', expect.anything());
    expect(document.activeElement).toBe(card.querySelector('.msg.thread-root'));
    v.destroy();
  });
});

// The test DOM keeps a row's formatted text as markup, not as elements, so a
// fenced block in a message never becomes the code block the renderer
// decorates. A message whose text holds a fence gets that block built the
// way the renderer builds it (the same decorateCodeBlock, on a pre of the
// fence's lines) so the fold and its button are the real ones.
/** See codeBlocksFromFences: registered for one test and taken off after it. */
function codeBlocksFromFences() {
  vi.doMock('../src/ui/message.js', async (importOriginal) => {
    const mod = await importOriginal();
    return {
      ...mod,
      renderMessage: (msg, ctx) => {
        const row = mod.renderMessage(msg, ctx);
        const fence = /```\n([\s\S]*?)\n```/.exec(msg.text || '');
        if (fence && row.querySelector('.msg-text')) {
          const pre = document.createElement('pre');
          pre.className = 'code-block';
          const code = document.createElement('code');
          code.textContent = fence[1];
          pre.append(code);
          row.querySelector('.msg-text').append(pre);
          mod.decorateCodeBlock(pre);
        }
        return row;
      },
    };
  });
}

describe('a code block unfolded on a Threads view card while the card is drawn again', () => {
  it('stays open, on the root and on a reply, as it does in the message list', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    const fence = `\`\`\`\n${Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')}\n\`\`\``;
    const root = { seq: 1, user: 'u2', ts: 1_700_000_000_001, text: `a trace:\n${fence}`, kind: 'msg', replyCount: 1, attachments: [], mentions: [], reactions: {} };
    const reply = { seq: 1, user: 'u3', ts: 1_700_000_000_002, text: `mine:\n${fence}`, kind: 'msg', attachments: [], mentions: [], reactions: {} };
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
      if (u.pathname.endsWith('/messages')) return json({ messages: [reply], seq: 1 });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    codeBlocksFromFences();
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    const wraps = () => [...card.querySelectorAll('.msg .code-wrap')];
    expect(wraps()).toHaveLength(2);
    expect(wraps().every((w) => w.classList.contains('folded'))).toBe(true);
    // The reader unfolds the reply's block to read it.
    wraps()[1].querySelector('.code-more').click();
    expect(wraps()[1].classList.contains('folded')).toBe(false);
    expect(wraps()[0].classList.contains('folded')).toBe(true);
    // A message lands in the channel: the card draws again, and the block stays open, the other stays shut.
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    expect(wraps()).toHaveLength(2);
    expect(wraps()[0].classList.contains('folded')).toBe(true);
    expect(wraps()[1].classList.contains('folded')).toBe(false);
    expect(wraps()[1].querySelector('.code-more').getAttribute('aria-expanded')).toBe('true');
    // Folded again by the reader, a reply landing keeps it shut.
    wraps()[1].querySelector('.code-more').click();
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    expect(wraps()[1].classList.contains('folded')).toBe(true);
    v.destroy();
    vi.doUnmock('../src/ui/message.js');
  });
});

describe('the keyboard on a control inside a Threads view card\'s row while the card is drawn again', () => {
  it('stays on the same control of the fresh row (a reaction pill, by its name), not the card\'s first button', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    const root = { seq: 1, user: 'u2', ts: 1_700_000_000_001, text: 'root 1', kind: 'msg', replyCount: 1, attachments: [], mentions: [], reactions: { '+1': { u3: 1_700_000_000_005 }, eyes: { u2: 1_700_000_000_006 } } };
    const reply = { seq: 1, user: 'u3', ts: 1_700_000_000_002, text: 'r1', kind: 'msg', attachments: [], mentions: [], reactions: {} };
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
      if (u.pathname.endsWith('/messages')) return json({ messages: [reply], seq: 1 });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    const pills = () => [...card.querySelectorAll('.msg.thread-root .reaction:not(.reaction-add)')];
    expect(pills()).toHaveLength(2);
    // Tabbed onto the root's second reaction pill.
    const pill = pills()[1];
    pill.focus();
    expect(document.activeElement).toBe(pill);
    store.emit('messages', { conv: 'c1', reason: 'poll' });
    await d.tick(2);
    expect(pills()[1]).not.toBe(pill);
    expect(document.activeElement).toBe(pills()[1]);
    expect(document.activeElement.getAttribute('aria-label')).toBe(pill.getAttribute('aria-label'));
    // And a button of a reply's hover bar, by its label.
    const replyRow = card.querySelector('.msg:not(.thread-root)');
    const more = replyRow.querySelector('[aria-label="More actions"]');
    more.focus();
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    const freshReply = card.querySelector('.msg:not(.thread-root)');
    expect(freshReply).not.toBe(replyRow);
    expect(document.activeElement).toBe(freshReply.querySelector('[aria-label="More actions"]'));
    // A focused row itself is found again, as before.
    freshReply.focus();
    store.emit('messages', { conv: 'c1_t1', reason: 'local' });
    await d.tick(2);
    expect(document.activeElement).toBe(card.querySelector('.msg:not(.thread-root)'));
    expect(document.activeElement).not.toBe(freshReply);
    v.destroy();
  });
});

describe('a reaction on the root of a Threads view card whose channel is not loaded here', () => {
  it('reaches the worker and shows on the card, rather than doing nothing', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    const root = { seq: 1, user: 'u2', ts: 1_700_000_000_001, text: 'root 1', kind: 'msg', replyCount: 1, attachments: [], mentions: [], reactions: {} };
    const calls = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      if (u.pathname.endsWith('/reactions')) { calls.push(JSON.parse(init.body)); return json({ ok: true }); }
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    // The quick reactions on a row's hover bar are drawn once the emoji table has loaded.
    await (await import('../src/lib/emoji.js')).loadEmoji();
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    // The channel itself was never opened in this tab: the root is drawn from the worker's listing.
    expect(store.conv('c1').messages.find((m) => m.seq === 1)).toBeUndefined();
    const quick = card.querySelector('.msg.thread-root [aria-label^="React with"]');
    expect(quick).toBeTruthy();
    quick.click();
    await d.tick(5);
    expect(calls).toHaveLength(1);
    expect(calls[0].on).toBe(true);
    const pill = card.querySelector('.msg.thread-root .reaction:not(.reaction-add)');
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    // Pressed again, the reaction comes off, on the card and on the worker.
    pill.click();
    await d.tick(5);
    expect(calls).toHaveLength(2);
    expect(calls[1].on).toBe(false);
    expect(card.querySelector('.msg.thread-root .reaction:not(.reaction-add)')).toBeNull();
    v.destroy();
  });

  it('takes the reaction back off the card when the worker refuses it', async () => {
    const { dom: d } = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/threads` });
    const root = { seq: 1, user: 'u2', ts: 1_700_000_000_001, text: 'root 1', kind: 'msg', replyCount: 1, attachments: [], mentions: [], reactions: {} };
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/threads')) return json({ threads: [{ id: 'c1_t1', conv: 'c1', seq: 1, at: 5000, unread: 0, root }] });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      if (u.pathname.endsWith('/reactions')) return json({ code: 'archived', message: 'This channel is archived' }, 403);
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    await (await import('../src/lib/emoji.js')).loadEmoji();
    const { toast } = await import('../src/ui/toast.js');
    const { createListView } = await import('../src/ui/views.js');
    const v = createListView('threads');
    document.body.append(v.el);
    await d.tick(10);
    const card = v.el.querySelector('.thread-card[data-thread="c1_t1"]');
    card.querySelector('.msg.thread-root [aria-label^="React with"]').click();
    await d.tick(5);
    expect(card.querySelector('.msg.thread-root .reaction:not(.reaction-add)')).toBeNull();
    expect(toast).toHaveBeenCalledWith('This channel is archived', expect.anything());
    v.destroy();
  });
});

describe('a reaction on the root of a thread opened from a link, while the channel\'s window does not reach it', () => {
  it('reaches the worker and shows on the panel\'s root row', async () => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    await (await import('../src/lib/emoji.js')).loadEmoji();
    const root = { ...message(5), replyCount: 1 };
    const calls = [];
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/reactions')) { calls.push(JSON.parse(init.body)); return json({ ok: true }); }
      // The root alone, asked for by number (the window holds the newest messages, 40 and up).
      if (u.pathname.endsWith('/messages') && u.searchParams.get('from') === '5') return json({ messages: [root], seq: 45 });
      if (u.pathname.endsWith('/messages')) return json({ messages: [], seq: 0 });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    Object.assign(store.conv('c1'), { loaded: true, seq: 45, hasMore: true, messages: [message(44), message(45)] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 1, hasMore: false, messages: [{ ...message(1, 'u3'), text: 'r1' }] });
    store.act.c.c1 = { s: 45 };
    const panel = document.createElement('div');
    document.body.append(panel);
    renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    await d.tick(10);
    const rootRow = () => panel.querySelector('.msg.thread-root');
    expect(rootRow()).toBeTruthy();
    expect(store.conv('c1').messages.find((m) => m.seq === 5)).toBeUndefined();
    rootRow().querySelector('[aria-label^="React with"]').click();
    await d.tick(5);
    expect(calls).toHaveLength(1);
    const pill = rootRow().querySelector('.reaction:not(.reaction-add)');
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the unread count over a block closed early', () => {
  it('leaves out the numbers the closing skipped, which stand for no message', async () => {
    await boot();
    // The counter stands at 51: messages 1..11, then a block closed early
    // (12..50 stand for nothing), then message 51 in the next block.
    store.act.c.c1 = { s: 51, t: 1, k: [12, 50] };
    store.me.reads.c1 = 11;
    expect(store.unreadCount('c1')).toBe(1);
    store.me.reads.c1 = 5;
    expect(store.unreadCount('c1')).toBe(7); // 6..11 and 51
    store.me.reads.c1 = 51;
    expect(store.unreadCount('c1')).toBe(0);
    // A cursor inside the skipped run (the reader's device read to the counter of the time): only what came after counts.
    store.me.reads.c1 = 30;
    expect(store.unreadCount('c1')).toBe(1);
    // No closing recorded: the count as it always was.
    store.act.c.c1 = { s: 51, t: 1 };
    store.me.reads.c1 = 11;
    expect(store.unreadCount('c1')).toBe(40);
  });
});
