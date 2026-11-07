import { afterEach, expect, it } from 'vitest';
import { accountStorageKey, adoptStorageFrom, clearAccountStorage, setGuestStorage, setStorageUser } from '../src/lib/account-storage.js';
import { draftKey } from '../src/lib/drafts.js';
import { memoryStorage } from './helpers/memory-storage.js';

afterEach(() => setGuestStorage());

it('identifies the storage owner before the document title when signing out', () => {
  const store = memoryStorage();
  const owner = 'uuid:alice';
  const name = `Report${accountStorageKey('', owner)}2026`;
  const foreign = draftKey(null, name, 'uuid:bob');
  const mine = draftKey(null, name, owner);
  store.setItem(foreign, 'Bob’s unsaved spreadsheet');
  store.setItem(mine, 'Alice’s unsaved spreadsheet');
  expect(clearAccountStorage(owner, store)).toBe(1);
  expect(store.getItem(foreign)).toBe('Bob’s unsaved spreadsheet');
  expect(store.getItem(mine)).toBeNull();
});

it.each(['guest', 'session:pending'])('adopts only records owned by %s and leaves owner-like text in titles intact', (from) => {
  const store = memoryStorage();
  setStorageUser({ uuid: 'alice' });
  const name = `Report${accountStorageKey('', from)}2026`;
  const foreign = draftKey(null, name, 'uuid:bob');
  const original = draftKey(null, name, from);
  const adopted = draftKey(null, name, 'uuid:alice');
  store.setItem(foreign, 'Bob’s unsaved spreadsheet');
  store.setItem(original, 'Guest’s unsaved spreadsheet');
  expect(adoptStorageFrom(from, store)).toBe(1);
  expect(store.getItem(foreign)).toBe('Bob’s unsaved spreadsheet');
  expect(store.getItem(original)).toBeNull();
  expect(store.getItem(adopted)).toBe('Guest’s unsaved spreadsheet');
  expect(store.keys()).toHaveLength(2);
});

it('leaves unscoped legacy drafts alone when their titles contain account markers', () => {
  const store = memoryStorage();
  const guest = 'spreadsheet:draft:new:Report:account:guest:2026';
  const account = 'spreadsheet:draft:Spreadsheets/Report:account:uuid%3Aalice:2026.xlsx';
  store.setItem(guest, 'Unknown owner');
  store.setItem(account, 'Unknown owner');
  setStorageUser({ uuid: 'alice' });
  expect(adoptStorageFrom('guest', store)).toBe(0);
  expect(clearAccountStorage('uuid:alice', store)).toBe(0);
  expect(store.getItem(guest)).toBe('Unknown owner');
  expect(store.getItem(account)).toBe('Unknown owner');
});
