// @vitest-environment jsdom
/**
 * Third review: what sign out removed from this device must not be written
 * back as the page unloads.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { createIdbCache } from '../src/core/cache.js';
import { tick } from './helpers.js';

vi.mock('../src/ui/shell.js', () => ({ buildShell: () => ({ root: document.createElement('div'), main: document.createElement('main'), updateAccount() {} }) }));
vi.mock('../src/ui/viewhost.js', () => ({ startViews() {} }));
vi.mock('../src/ui/theme.js', () => ({ initTheme() {} }));
vi.mock('../src/ui/alpha.js', () => ({ showAlphaNotice() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/views/onboarding.js', () => ({ maybeOnboard: vi.fn() }));
vi.mock('../src/core/backend.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, createPuterBackend: () => real.createMemoryBackend() };
});
vi.mock('../src/team.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadWorkspaces: vi.fn(async () => ({ current: 'own', own: {}, joined: [] })),
  updateWorkerIfNeeded: vi.fn(),
}));

describe('sign out', () => {
  it('leaves no offline copy behind when a change was made just before', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/#/');
    globalThis.puter = { auth: { isSignedIn: () => true, getUser: async () => ({ username: 'director', uuid: 'u1' }), getProfilePicture: async () => null, signOut: vi.fn() }, kv: {} };
    const { app } = await import('../src/app.js');
    await import('../src/main.js');
    for (let i = 0; i < 40 && !app.store?.state.loaded; i++) await tick(5);
    app.store.put('students', { firstName: 'Ava', allergies: 'Peanuts' });
    const platform = await import('../src/platform.js');
    await platform.signOut('u1');
    // location.reload() then unloads the page, which runs the pagehide handler.
    window.dispatchEvent(new Event('pagehide'));
    await tick(700);
    expect(await createIdbCache('user:u1').load()).toBeUndefined();
    delete globalThis.puter;
  });
});
