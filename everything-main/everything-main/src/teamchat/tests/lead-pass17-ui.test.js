/**
 * Conversation UI checked by the lead in review pass 17, driven in node
 * through tests/helpers/dom.js as the pass-14 conversation tests are.
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

async function boot({ width = 1280, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ width, ...env });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 },
    },
  };
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  return { store, dom };
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

const message = (seq, extra = {}) => ({ seq, user: 'u2', text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });

describe('the settings dialog opened for one part of it', () => {
  const open = async (opts) => {
    const { dom: d } = await boot();
    store.statusOf = () => null;
    store.notificationsPaused = () => false;
    const { settingsDialog } = await import('../src/ui/dialogs.js');
    settingsDialog(opts);
    await d.tick(2);
    const root = [...document.querySelectorAll('input.input')].find((n) => n.placeholder === 'What are you up to?')?.closest('div');
    return { d, dialog: root ? document.body : null };
  };

  it('puts the keyboard in the status box for "Set a status"', async () => {
    await open({ section: 'status' });
    const a = document.activeElement;
    expect(a?.tagName).toBe('INPUT');
    expect(a.placeholder).toBe('What are you up to?');
  });

  it('puts the keyboard on the chosen theme for the theme item', async () => {
    await open({ section: 'appearance' });
    const a = document.activeElement;
    expect(a?.getAttribute('role')).toBe('radio');
    expect(a.getAttribute('aria-checked')).toBe('true');
    expect(a.closest('[aria-label="Theme"]')).toBeTruthy();
  });

  it('puts the keyboard on the Quiet hours switch for the menu\'s Quiet hours', async () => {
    await open({ section: 'quiet' });
    const a = document.activeElement;
    expect(a?.getAttribute('role')).toBe('switch');
    expect(a.textContent).toContain('Quiet hours');
  });

  it('leaves the keyboard where the dialog puts it when opened for no part in particular', async () => {
    await open();
    expect(document.activeElement?.placeholder).not.toBe('What are you up to?');
    expect(document.activeElement?.getAttribute('role')).toBeFalsy();
  });
});

describe('the shortcuts panel', () => {
  it('lists the arrows that walk the message list, beside the message keys', async () => {
    await boot();
    const { SHORTCUT_GROUPS } = await import('../src/ui/shortcuts.js');
    const messages = SHORTCUT_GROUPS.find(([title]) => /^Messages/.test(title))[1];
    const keys = messages.map(([, k]) => k.join('+'));
    expect(keys).toEqual(expect.arrayContaining(['↑', '↓', 'Home', 'End', 'R', 'E']));
    // The arrows come first: they are how the keys after them are reached.
    expect(keys.slice(0, 4)).toEqual(['↑', '↓', 'Home', 'End']);
  });
});

describe('the thread panel opened on a line the worker wrote', () => {
  const openThread = async (root) => {
    const { dom: d } = await boot();
    const { renderThreadPanel } = await import('../src/ui/panel.js');
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    Object.assign(store.conv('c1'), { loaded: true, seq: root.seq, hasMore: false, messages: [root] });
    Object.assign(store.conv(`c1_t${root.seq}`), { loaded: true, seq: 0, hasMore: false, messages: [] });
    store.act.c.c1 = { s: root.seq };
    const panel = document.createElement('div');
    document.body.append(panel);
    renderThreadPanel(panel, { convId: 'c1', seq: root.seq, onClose() {} });
    await d.tick(5);
    return panel;
  };

  it('offers no reply box and no follow bell under a system line', async () => {
    const panel = await openThread(message(2, { kind: 'sys', text: 'ana joined' }));
    expect(panel.querySelector('textarea')).toBeNull();
    expect(panel.querySelector('.composer-blocked')?.textContent).toBe('System lines have no thread');
    expect(panel.querySelector('.also-send')).toBeNull();
    const bell = panel.querySelector('.panel-head [aria-label*="thread"]');
    expect(bell.hidden).toBe(true);
    // The line itself is shown at the head of the panel.
    expect(panel.querySelector('.msg.sys')?.textContent).toContain('ana joined');
  });

  it('says a reminder has no thread', async () => {
    const panel = await openThread(message(3, { kind: 'rem', user: 'u-me', text: 'Reminder: follow up' }));
    expect(panel.querySelector('textarea')).toBeNull();
    expect(panel.querySelector('.composer-blocked')?.textContent).toBe('Reminders have no thread');
  });

  it('keeps the reply box and the bell under a message a member wrote', async () => {
    const panel = await openThread(message(4));
    expect(panel.querySelector('textarea')).toBeTruthy();
    expect(panel.querySelector('.composer-blocked')).toBeNull();
    expect(panel.querySelector('.panel-head [aria-label*="thread"]').hidden).toBe(false);
  });
});
