// @vitest-environment jsdom
/**
 * Second review: a staff member's device must not fall back to their own
 * empty school when reading the workspace list fails for a moment.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from './helpers.js';

const URL_A = 'https://childcare-abcdefghij.puter.work';
const backends = [];
let started = false;
vi.mock('../src/ui/shell.js', () => ({ buildShell: () => ({ root: document.createElement('div'), main: document.createElement('main'), updateAccount() {} }) }));
vi.mock('../src/ui/viewhost.js', () => ({ startViews: () => (started = true) }));
vi.mock('../src/ui/theme.js', () => ({ initTheme() {} }));
vi.mock('../src/ui/alpha.js', () => ({ showAlphaNotice() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/views/onboarding.js', () => ({ maybeOnboard: vi.fn() }));
vi.mock('../src/core/backend.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, createPuterBackend: () => (backends.push('own'), real.createMemoryBackend()) };
});
vi.mock('../src/team.js', async (importOriginal) => {
  const real = await importOriginal();
  const { createMemoryBackend } = await import('../src/core/backend.js');
  return {
    ...real,
    updateWorkerIfNeeded: vi.fn(),
    createWorkerBackend: (url) => (backends.push(url), createMemoryBackend()),
    call: vi.fn(async (url, op) => (op === 'whoami' ? { ok: true, role: 'staff', staffId: 't1', school: 'Acorn' } : { ok: true })),
  };
});

describe('workspace list', () => {
  it('uses the last known list when reading it fails', async () => {
    const ws = { current: URL_A, own: {}, joined: [{ url: URL_A, school: 'Acorn', role: 'staff', me: { guardianId: null, staffId: 't1', studentIds: null } }] };
    const kv = {
      fail: false,
      async get() {
        if (this.fail) throw new Error('Network error');
        return structuredClone(ws);
      },
      async set() {},
    };
    // An earlier visit read it fine.
    const team = await import('../src/team.js');
    const { app } = await import('../src/app.js');
    app.user = { username: 'teacher', uuid: 'u9' };
    await team.saveWorkspaces(kv, ws);
    app.user = null;
    kv.fail = true;

    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', '/#/');
    globalThis.puter = { auth: { isSignedIn: () => true, getUser: async () => ({ username: 'teacher', uuid: 'u9' }), getProfilePicture: async () => null }, kv };
    await import('../src/main.js');
    for (let i = 0; i < 40 && !started; i++) await tick(5);
    expect(backends).toEqual([URL_A]);
    expect(app.team?.url).toBe(URL_A);
    delete globalThis.puter;
  });
});
