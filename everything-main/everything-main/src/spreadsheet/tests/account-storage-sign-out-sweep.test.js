// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { accountStorageKey, adoptGuestStorage, clearAccountStorage, setGuestStorage, setStorageUser, storageScope } from '../src/lib/account-storage.js';
import { draftKey, listDrafts, saveDraft } from '../src/lib/drafts.js';
import { rememberRecent, recentFiles } from '../src/lib/recent.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); setGuestStorage(); });
afterEach(() => { vi.restoreAllMocks(); setGuestStorage(); });

/** A draft, a recent file and an outside-content decision kept for whoever the app is signed in as now. */
function recordsForCurrentScope(who) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, `${who}'s salary`);
  expect(saveDraft(draftKey('Spreadsheets/Private.xlsx'), wb, 'Private', `rev-${who}`)).toBe(true);
  rememberRecent(`/${who}/Secret.xlsx`, 'Secret');
  localStorage.setItem(`${accountStorageKey('spreadsheet:external')}Spreadsheets/Private.xlsx`, '1');
}

// Signing out is how a user takes their work off a shared computer, but every record this browser
// kept for the account — whole unsaved spreadsheets among them — stayed behind for good.
it('removes every record kept for the account being left, and nothing else', () => {
  setStorageUser({ uuid: 'u-1' });
  recordsForCurrentScope('alice');
  expect(localStorage.keys()).toHaveLength(3);
  setStorageUser({ uuid: 'u-10' }); // an account whose id starts with the first one's
  recordsForCurrentScope('bob');
  setGuestStorage();
  recordsForCurrentScope('a visitor');
  localStorage.setItem('spreadsheet:settings:v1', '{"theme":"dark"}'); // kept for the browser, not for an account

  expect(clearAccountStorage('uuid:u-1')).toBe(3);
  expect(localStorage.keys().filter((k) => k.includes('uuid%3Au-1:'))).toEqual([]);
  // The other account, the visitor's records and the theme all stand.
  expect(localStorage.keys().filter((k) => k.includes('uuid%3Au-10:'))).toHaveLength(3);
  expect(localStorage.keys().filter((k) => k.includes(':account:guest:'))).toHaveLength(3);
  expect(localStorage.getItem('spreadsheet:settings:v1')).toBe('{"theme":"dark"}');

  // Nothing of the account's is offered to whoever signs in next.
  setStorageUser({ uuid: 'u-1' });
  expect(listDrafts()).toEqual([]);
  expect(recentFiles()).toEqual([]);
  expect(localStorage.getItem(`${accountStorageKey('spreadsheet:external')}Spreadsheets/Private.xlsx`)).toBeNull();
});

it('sweeps the scope the app is in when none is named, and says how many records went', () => {
  setStorageUser({ uuid: 'u-2' });
  recordsForCurrentScope('carol');
  expect(storageScope()).toBe('uuid:u-2');
  expect(clearAccountStorage()).toBe(3);
  expect(clearAccountStorage()).toBe(0);
  expect(localStorage.keys()).toEqual([]);
});

// A visitor's records follow a sign-in into the account; the sweep must not take them before then.
it('leaves the guest scope alone while an account is swept', () => {
  setGuestStorage();
  recordsForCurrentScope('a visitor');
  setStorageUser({ uuid: 'u-3' });
  expect(clearAccountStorage()).toBe(0);
  expect(adoptGuestStorage()).toBe(3);
  expect(clearAccountStorage()).toBe(3);
  expect(localStorage.keys()).toEqual([]);
});

it('answers 0 rather than throwing when storage refuses or no scope is named', () => {
  const store = { get length() { throw new Error('denied'); }, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {} };
  expect(clearAccountStorage('uuid:u-4', store)).toBe(0);
  expect(clearAccountStorage('')).toBe(0);
});
