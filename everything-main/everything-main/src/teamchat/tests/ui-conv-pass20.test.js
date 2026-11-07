/**
 * Conversation UI (review pass 20), driven in node through
 * tests/helpers/dom.js as the pass-19 file is: a fresh DOM and a fresh
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

const message = (seq, user = 'u2', extra = {}) => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, ...extra });

/** A conversation view on #general with the given messages, its rows and the menu on the page. */
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
  const items = () => [...document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent);
  return { d, view, rows, menu, items };
}

describe('Shift+F10 on a message row whose hover bar the stylesheet keeps off the page', () => {
  it('hangs the menu from the row itself, as a long press does, rather than from a button with no box', async () => {
    const { d, view, rows, menu } = await openView([message(1)]);
    const row = rows()[0];
    const more = row.querySelector('.msg-actions [aria-label="More actions"]');
    // Where there is no hover (a tablet with a keyboard, a phone) the bar is
    // display: none, and its button has no box to open a menu from.
    Object.defineProperty(more, 'offsetParent', { get: () => null });
    row.focus();
    d.key(row, 'F10', { shiftKey: true });
    expect(menu()).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(more.getAttribute('aria-expanded')).toBeNull();
    await d.tick(1);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    expect(menu()).toBeNull();
    // The keyboard goes back to the row it came from.
    expect(document.activeElement).toBe(row);
    view.destroy();
  });

  it('hangs it from the bar’s own More where the bar is drawn, as before', async () => {
    const { d, view, rows, menu } = await openView([message(1)]);
    const row = rows()[0];
    const more = row.querySelector('.msg-actions [aria-label="More actions"]');
    row.focus();
    d.key(row, 'F10', { shiftKey: true });
    expect(menu()).toBeTruthy();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    await d.tick(1);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    expect(document.activeElement).toBe(more);
    view.destroy();
  });
});

describe('the waiting card under a queued message with a file still on this device', () => {
  // The outbox is on this file (`up`, see outbox.js list): with the message
  // in line and the connection up, it is the one going up.
  const file = { name: 'pic.png', size: 10, type: 'image/png', uploading: true, up: true };
  const queued = (extra) => ({ seq: null, tempId: 't1', user: 'u-me', text: 'see', ts: 1_700_000_000_000, kind: 'msg', queued: true, attachments: [file], mentions: [], reactions: {}, replyCount: 0, ...extra });

  it('says the file waits to upload when the outbox has set the message aside ("Not sent"), not that it is uploading', async () => {
    await boot();
    const { renderMessage } = await import('../src/ui/message.js');
    const ctx = { convId: 'c1', onShowMember() {}, membersByUsername: store.membersByUsername() };
    const failed = renderMessage(queued({ failed: true, error: { message: 'Not sent' } }), ctx);
    expect(failed.querySelector('.msg-failed-row').textContent).toContain('Not sent');
    expect(failed.querySelector('.attachment-waiting').textContent).toContain('Waiting to upload');
    expect(failed.querySelector('.attachment-waiting').textContent).not.toContain('Uploading');
    // Still in line, with the connection up and the outbox on its file: on its way.
    const live = renderMessage(queued({ failed: false, error: null }), ctx);
    expect(live.querySelector('.attachment-waiting').textContent).toContain('Uploading');
  });
});

describe('the menu of a message made of files alone', () => {
  const file = { id: 'f1', name: 'pic.png', size: 10, type: 'image/png' };

  it('offers no "Copy text": there are no words, and the press put an empty string over what was on the clipboard and said "Copied"', async () => {
    const { d, view, rows, items } = await openView([message(1, 'u3', { text: '', attachments: [file] }), message(2, 'u3', { text: 'words', attachments: [file] })]);
    rows()[0].querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    expect(items().some((t) => /Copy text/.test(t))).toBe(false);
    expect(items().some((t) => /Copy link/.test(t))).toBe(true);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    // A message with words keeps it.
    rows()[1].querySelector('[aria-label="More actions"]').click();
    await d.tick(1);
    expect(items().some((t) => /Copy text/.test(t))).toBe(true);
    d.key(document.activeElement, 'Escape');
    await d.tick(1);
    view.destroy();
  });
});
