// @vitest-environment jsdom
/**
 * Second review: a kiosk tablet stays a kiosk after a reload, a new URL, or a
 * browser restart; only the exit flow unlocks it.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from './helpers.js';

let hashAtStart = null;
vi.mock('../src/ui/shell.js', () => ({ buildShell: () => ({ root: document.createElement('div'), main: document.createElement('main'), updateAccount() {} }) }));
vi.mock('../src/ui/viewhost.js', () => ({ startViews: () => (hashAtStart = location.hash) }));
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

describe('kiosk lock', () => {
  it('is remembered for this person and school, and cleared only by leaving the kiosk', async () => {
    const { app, setKioskLock } = await import('../src/app.js');
    app.user = { username: 'director', uuid: 'u1' };
    setKioskLock(true);
    expect(app.kioskLock).toBe(true);
    // Another person on the same browser is not locked.
    app.user = { username: 'other', uuid: 'u2' };
    const { restoreKioskLock } = await import('../src/app.js');
    restoreKioskLock();
    expect(app.kioskLock).toBe(false);
    app.user = { username: 'director', uuid: 'u1' };
    restoreKioskLock();
    expect(app.kioskLock).toBe(true);
  });

  it('opens straight into the kiosk when the tablet reloads at another address', async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/?x#/');
    globalThis.puter = { auth: { isSignedIn: () => true, getUser: async () => ({ username: 'director', uuid: 'u1' }), getProfilePicture: async () => null }, kv: {} };
    // What kiosk.js stored when the kiosk was opened earlier.
    const { app, setKioskLock } = await import('../src/app.js');
    app.user = { username: 'director', uuid: 'u1' };
    setKioskLock(true);
    app.kioskLock = false; // a fresh page knows nothing in memory
    app.user = null;
    await import('../src/main.js');
    for (let i = 0; i < 40 && hashAtStart === null; i++) await tick(5);
    expect(app.kioskLock).toBe(true);
    expect(hashAtStart).toBe('#/kiosk');
    const { maybeOnboard } = await import('../src/views/onboarding.js');
    await tick(5);
    expect(maybeOnboard).not.toHaveBeenCalled();
    delete globalThis.puter;
  });
});
