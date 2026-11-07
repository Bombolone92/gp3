// @vitest-environment jsdom
/**
 * Second review: starting from the offline snapshot when Puter cannot say
 * who is signed in, but only for the same session.
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
  loadWorkspaces: vi.fn(async () => {
    throw new Error('Network error');
  }),
  updateWorkerIfNeeded: vi.fn(),
}));

async function boot(token) {
  vi.resetModules();
  started = 0;
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '/#/');
  globalThis.puter = {
    authToken: token,
    auth: { isSignedIn: () => true, getUser: async () => Promise.reject(new Error('Failed to fetch')), getProfilePicture: async () => null },
    kv: {},
  };
  await import('../src/main.js');
  for (let i = 0; i < 40 && !started && !document.querySelector('.welcome'); i++) await tick(5);
  const { app } = await import('../src/app.js');
  return app;
}

describe('Puter cannot say who is signed in', () => {
  it('starts as the last person seen in this same session', async () => {
    globalThis.puter = { authToken: 'session-1' };
    const platform = await import('../src/platform.js');
    await platform.rememberUser({ username: 'director', uuid: 'u1' });
    const app = await boot('session-1');
    expect(started).toBe(1);
    expect(app.user).toEqual({ username: 'director', uuid: 'u1' });
  });

  it('does not open someone else\'s cached school in a different session', async () => {
    const app = await boot('session-2');
    expect(started).toBe(0);
    expect(app.user).toBeNull();
    expect(document.querySelector('.welcome')).not.toBeNull();
    delete globalThis.puter;
  });
});
