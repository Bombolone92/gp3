/**
 * Lead's own checks for review pass 16, driven in node through
 * tests/helpers/dom.js as the ui-conv files are: a fresh DOM and a fresh
 * module registry for every test, the toast, the theme, the modal layer and
 * navigation mocked, and the move of a workspace held by a mock.
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

async function boot() {
  dom?.uninstall();
  dom = installDom({ width: 1280 });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: 'u2', transferTo: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 2 } },
    members: {
      'u-me': { role: 'admin', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'owner', name: 'Ana Rocha', username: 'ana', color: 2 },
    },
  };
  store.me = { role: 'admin', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  return { store, dom };
}

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

describe('taking over a workspace whose queue did not fit the new server', () => {
  it('says how many scheduled messages were left behind, with the rest of the closing word', async () => {
    const { dom: d } = await boot();
    const { acceptTransferDialog } = await import('../src/ui/dialogs.js');
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    toast.mockClear();
    vi.spyOn(store, 'ensureOwnWorker').mockResolvedValue({ url: 'https://mine.test' });
    vi.spyOn(store, 'profileSeed').mockReturnValue({});
    vi.spyOn(store, '_addWorkspace').mockResolvedValue(undefined);
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    // The move's result carries what the new server said of the queue (see transferWorkspace).
    archive.transferWorkspace.mockResolvedValue({ ref: 'new@mine', mine: true, icon: null, scheduled: { kept: 3, dropped: 2 } });
    acceptTransferDialog();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept and move it here').click();
    await d.tick(5);
    const said = toast.mock.calls.map(([t]) => t).find((t) => /now yours/.test(t));
    expect(said).toMatch(/2 scheduled messages and reminders could not be brought across/);
    expect(said).toMatch(/the 3 due soonest were/);
    expect(said).toMatch(/old copy.s Later view/);
    // Shown long enough to be read, as the integrations note is.
    expect(toast.mock.calls.find(([t]) => /now yours/.test(t))[1].duration).toBe(12000);
  });

  it('says nothing of the queue when the server said nothing, as before', async () => {
    const { dom: d } = await boot();
    const { acceptTransferDialog } = await import('../src/ui/dialogs.js');
    const archive = await import('../src/lib/archive.js');
    const { toast } = await import('../src/ui/toast.js');
    toast.mockClear();
    vi.spyOn(store, 'ensureOwnWorker').mockResolvedValue({ url: 'https://mine.test' });
    vi.spyOn(store, 'profileSeed').mockReturnValue({});
    vi.spyOn(store, '_addWorkspace').mockResolvedValue(undefined);
    vi.spyOn(store, 'forgetWorkspace').mockResolvedValue(undefined);
    archive.transferWorkspace.mockResolvedValue({ ref: 'new@mine', mine: true, icon: null });
    acceptTransferDialog();
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept and move it here').click();
    await d.tick(5);
    const said = toast.mock.calls.map(([t]) => t).find((t) => /now yours/.test(t));
    expect(said).toBe('The workspace is now yours, on your server.');
    expect(toast.mock.calls.find(([t]) => /now yours/.test(t))[1].duration).toBe(8000);
  });
});

describe('the message box\'s Send and Send later while a "Send later" request is out', () => {
  it('draw the wait as the disabled state is drawn, now that they are busy rather than disabled', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    // The composer marks both buttons aria-busy (not disabled) so the keyboard stays on Send later (see composer.js).
    expect(css).toMatch(/\.send-btn\[disabled\],\s*\.send-btn\[aria-busy="true"\]\s*\{\s*opacity: 0\.4;/);
    expect(css).toMatch(/\.send-later\[disabled\],\s*\.send-later\[aria-busy="true"\]\s*\{\s*opacity: 0\.4;/);
  });
});
