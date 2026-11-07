// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmSignOut } from '../src/ui/appmenu.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';
import { accountStorageKey, setStorageUser, setGuestStorage } from '../src/lib/account-storage.js';

function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

let listener;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('location', { hash: '#/edit/Plan', reload: vi.fn() });
  vi.stubGlobal('localStorage', memoryStorage());
  vi.spyOn(P, 'signOut').mockImplementation(() => {});
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  window.removeEventListener('app:before-signout', listener);
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('signing out', () => {
  it.each([true, false])('waits for saving and signs out only on success (%s)', async (saved) => {
    let resolve;
    const saving = new Promise((done) => { resolve = done; });
    listener = (e) => e.detail?.waitUntil(saving);
    window.addEventListener('app:before-signout', listener);
    const pending = confirmSignOut();
    [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Sign out').click();
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(P.signOut).not.toHaveBeenCalled();
      resolve(saved);
      await pending;
      expect(P.signOut).toHaveBeenCalledTimes(saved ? 1 : 0);
      expect(location.reload).toHaveBeenCalledTimes(saved ? 1 : 0);
    } finally { resolve(saved); await pending; }
  });

  // Sign out left every account-scoped record in localStorage: the drafts hold whole unsaved
  // spreadsheets, and the recents the names and drive paths of the account's files, so the next
  // person on a shared computer could read them from devtools. They go with the sign-out now.
  it('removes the account’s drafts, recents and decisions from this browser', async () => {
    setStorageUser({ uuid: 'abc-123' });
    const mine = accountStorageKey('');
    localStorage.setItem(`spreadsheet:draft${mine}Spreadsheets/Plan.xlsx`, '{"workbook":"secret"}');
    localStorage.setItem(`spreadsheet:recent${mine}`, '["Spreadsheets/Plan.xlsx"]');
    localStorage.setItem('spreadsheet:zoom', '1.25'); // a device setting, not the account's data
    const pending = confirmSignOut();
    [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Sign out').click();
    await pending;
    expect(P.signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`spreadsheet:draft${mine}Spreadsheets/Plan.xlsx`)).toBeNull();
    expect(localStorage.getItem(`spreadsheet:recent${mine}`)).toBeNull();
    expect(localStorage.getItem('spreadsheet:zoom')).toBe('1.25');
    setGuestStorage();
  });

  it('leaves another account’s records alone', async () => {
    setStorageUser({ uuid: 'other' });
    const theirs = accountStorageKey('');
    setStorageUser({ uuid: 'abc-123' });
    const mine = accountStorageKey('');
    localStorage.setItem(`spreadsheet:draft${theirs}Spreadsheets/Plan.xlsx`, 'theirs');
    localStorage.setItem(`spreadsheet:draft${mine}Spreadsheets/Plan.xlsx`, 'mine');
    const pending = confirmSignOut();
    [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Sign out').click();
    await pending;
    expect(localStorage.getItem(`spreadsheet:draft${mine}Spreadsheets/Plan.xlsx`)).toBeNull();
    expect(localStorage.getItem(`spreadsheet:draft${theirs}Spreadsheets/Plan.xlsx`)).toBe('theirs');
    setGuestStorage();
  });
});
