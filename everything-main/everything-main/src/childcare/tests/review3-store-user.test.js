// @vitest-environment jsdom
/**
 * Third review: the offline start is for Puter being unreachable, not for a
 * session Puter refused.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from './helpers.js';

let started = 0;
vi.mock('../src/ui/shell.js', () => ({ buildShell: () => ({ root: document.createElement('div'), main: document.createElement('main'), updateAccount() {} }) }));
vi.mock('../src/ui/viewhost.js', () => ({ startViews: () => started++ }));
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

describe('Puter refuses the session', () => {
  it('shows the welcome screen instead of opening the offline copy', async () => {
    globalThis.puter = { authToken: 'session-1' };
    const platform = await import('../src/platform.js');
    await platform.rememberUser({ username: 'director', uuid: 'u1' });
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/#/');
    // What puter.auth.getUser rejects with when /whoami answers 401.
    globalThis.puter = {
      authToken: 'session-1',
      auth: { isSignedIn: () => true, getUser: async () => Promise.reject({ status: 401, message: 'Unauthorized' }), getProfilePicture: async () => null },
      kv: {},
    };
    await import('../src/main.js');
    for (let i = 0; i < 40 && !started && !document.querySelector('.welcome'); i++) await tick(5);
    expect(started).toBe(0);
    expect(document.querySelector('.welcome')).not.toBeNull();
    delete globalThis.puter;
  });
});
