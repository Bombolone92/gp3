// @vitest-environment jsdom
/**
 * Second review: opening a new invitation for a school already in the list
 * (main.js acceptInvite).
 */
import { describe, it, expect, vi } from 'vitest';
import { createMemoryBackend } from '../src/core/backend.js';
import { tick } from './helpers.js';

const URL_A = 'https://childcare-abcdefghij.puter.work';
const calls = [];
let membership = 'removed'; // the old membership no longer works

vi.mock('../src/ui/shell.js', () => ({ buildShell: () => ({ root: document.createElement('div'), main: document.createElement('main'), updateAccount() {} }) }));
vi.mock('../src/ui/viewhost.js', () => ({ startViews() {} }));
vi.mock('../src/ui/theme.js', () => ({ initTheme() {} }));
vi.mock('../src/ui/alpha.js', () => ({ showAlphaNotice() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/dialog.js', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('../src/views/onboarding.js', () => ({ maybeOnboard() {} }));
vi.mock('../src/team.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    loadWorkspaces: vi.fn(async () => ({ current: 'own', own: {}, joined: [{ url: URL_A, school: 'Acorn', role: 'staff', me: { guardianId: null, staffId: 't1', studentIds: null } }] })),
    saveWorkspaces: vi.fn(async () => {}),
    leaveWorkspace: vi.fn(async () => {}),
    updateWorkerIfNeeded: vi.fn(),
    createWorkerBackend: () => createMemoryBackend(),
    call: vi.fn(async (url, op) => {
      calls.push(op);
      if (op === 'join') {
        membership = 'ok';
        return { ok: true, school: 'Acorn', role: 'staff' };
      }
      if (op === 'whoami') {
        if (membership !== 'ok') throw Object.assign(new Error('removed'), { code: 'not_a_member' });
        return { ok: true, role: 'staff', staffId: 't1', school: 'Acorn' };
      }
      return { ok: true };
    }),
  };
});

describe('a new invitation to a school already in the list', () => {
  it('is used to join again instead of being dropped', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    history.replaceState(null, '', `/#/join?w=childcare-abcdefghij&t=${'T'.repeat(24)}`);
    globalThis.puter = {
      auth: { isSignedIn: () => true, getUser: async () => ({ username: 'teacher', uuid: 'u9' }), getProfilePicture: async () => null },
      kv: {},
    };
    const team = await import('../src/team.js');
    await import('../src/main.js');
    for (let i = 0; i < 20 && !calls.includes('whoami'); i++) await tick(5);
    await tick(5);
    expect(calls[0]).toBe('join');
    expect(team.leaveWorkspace).not.toHaveBeenCalled();
    delete globalThis.puter;
  });
});
