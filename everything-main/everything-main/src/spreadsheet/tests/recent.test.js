import { describe, it, expect } from 'vitest';
import { recentFiles, rememberRecent, forgetRecent } from '../src/lib/recent.js';
import { accountStorageKey } from '../src/lib/account-storage.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('recent files', () => {
  it('does not interrupt opening a file when browser storage access is blocked', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage access denied'); } });
    try {
      expect(recentFiles()).toEqual([]);
      expect(() => rememberRecent('Spreadsheets/Plan.xlsx', 'Plan')).not.toThrow();
      expect(() => forgetRecent('Spreadsheets/Plan.xlsx')).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete globalThis.localStorage;
    }
  });

  it('remembers the newest first, without duplicates, up to a limit, and forgets on request', () => {
    const st = memoryStorage();
    expect(recentFiles(st)).toEqual([]);
    rememberRecent('/a/one.xlsx', 'one', st);
    rememberRecent('/a/two.xlsx', 'two', st);
    rememberRecent('/a/one.xlsx', 'one', st);
    expect(recentFiles(st).map((r) => r.path)).toEqual(['/a/one.xlsx', '/a/two.xlsx']);
    for (let i = 0; i < 12; i++) rememberRecent(`/b/${i}.xlsx`, `${i}`, st);
    expect(recentFiles(st)).toHaveLength(8);
    forgetRecent('/b/11.xlsx', st);
    expect(recentFiles(st).some((r) => r.path === '/b/11.xlsx')).toBe(false);
    st.setItem(accountStorageKey('spreadsheet:recent'), 'not json');
    expect(recentFiles(st)).toEqual([]);
  });
});
