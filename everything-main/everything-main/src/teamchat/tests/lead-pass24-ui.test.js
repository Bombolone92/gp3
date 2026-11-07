/**
 * Conversation UI (lead, review pass 24), driven in node through
 * tests/helpers/dom.js as the pass-23 file is: a fresh DOM and a fresh module
 * registry for every test, Puter faked at `puter.workers.exec`, the toast,
 * the theme, the modal layer and navigation mocked.
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

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });

/** A conversation column on #general, three messages read to the end (no "New" line), the store's read-sending stubbed. */
async function openReadToTheEnd() {
  const { dom: d } = await boot();
  const { createConversationView } = await import('../src/ui/conversation.js');
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
  store.me.reads.c1 = 3;
  store.act.c.c1 = { s: 3 };
  const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
  document.body.append(view.el);
  await d.tick(5);
  store.markRead.mockClear();
  return { d, view };
}

/** A teammate's message lands in the open conversation (the store's poll would emit this). */
function arrives(msg) {
  const conv = store.conv('c1');
  conv.messages = [...conv.messages, msg];
  conv.seq = msg.seq;
  store.act.c.c1 = { s: msg.seq };
  store.emit('messages', { conv: 'c1', reason: 'newer', added: [msg] });
}

/** The tab put away or brought back, as the browser tells the page. */
function tab(hidden) {
  document.hidden = hidden;
  document.visibilityState = hidden ? 'hidden' : 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('the "New" line for a message that arrives while the tab is put away', () => {
  it('is drawn over the first such message, stays when the reader comes back and the message is read, and goes when they post', async () => {
    const { d, view } = await openReadToTheEnd();
    const line = () => view.el.querySelector('.new-divider');
    expect(line()).toBeNull();
    // The reader switches to another tab; Ana posts twice meanwhile.
    tab(true);
    arrives(message(4));
    await d.tick(3);
    expect(store.markRead).not.toHaveBeenCalled();
    expect(line()?.nextElementSibling?.dataset.seq).toBe('4');
    arrives(message(5, 'u3'));
    await d.tick(3);
    // The line marks where they left, not the newest message.
    expect(view.el.querySelectorAll('.new-divider')).toHaveLength(1);
    expect(line()?.nextElementSibling?.dataset.seq).toBe('4');
    // Back on the tab, at the bottom: the two are read, and the line still says which two.
    tab(false);
    await d.tick(3);
    expect(store.markRead).toHaveBeenCalledWith('c1', 5);
    expect(line()?.nextElementSibling?.dataset.seq).toBe('4');
    // A message arriving now, with the reader looking, is read as it lands and moves no line.
    arrives(message(6));
    await d.tick(3);
    expect(line()?.nextElementSibling?.dataset.seq).toBe('4');
    // The reader answers: what they posted under they have read, and the line goes.
    const temp = { tempId: 't1', user: 'u-me', text: 'seen', ts: Date.now(), kind: 'msg', pending: true, attachments: [], mentions: [], reactions: {} };
    store.conv('c1').messages.push(temp);
    store.emit('messages', { conv: 'c1', reason: 'local', added: [temp] });
    await d.tick(3);
    expect(line()).toBeNull();
    view.destroy();
  });

  it('is not drawn for the reader’s own message from another tab, nor for a system line, and never while the reader is looking', async () => {
    const { d, view } = await openReadToTheEnd();
    const line = () => view.el.querySelector('.new-divider');
    tab(true);
    arrives(message(4, 'u-me'));
    arrives(message(5, 'u2', { kind: 'sys', text: 'Ana joined' }));
    await d.tick(3);
    expect(line()).toBeNull();
    tab(false);
    await d.tick(3);
    arrives(message(6));
    await d.tick(3);
    expect(line()).toBeNull();
    view.destroy();
  });

  it('leaves a line already standing where it is', async () => {
    const { dom: d } = await boot();
    const { createConversationView } = await import('../src/ui/conversation.js');
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    // Read to the second message: the list opens with the line over the third.
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
    store.me.reads.c1 = 2;
    store.act.c.c1 = { s: 3 };
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    await d.tick(5);
    const line = () => view.el.querySelector('.new-divider');
    expect(line()?.nextElementSibling?.dataset.seq).toBe('3');
    tab(true);
    arrives(message(4));
    await d.tick(3);
    expect(view.el.querySelectorAll('.new-divider')).toHaveLength(1);
    expect(line()?.nextElementSibling?.dataset.seq).toBe('3');
    tab(false);
    view.destroy();
  });
});
