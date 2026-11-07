import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { draftKey, saveDraft, loadDraft, listDrafts, isUnsavedDraftKey } from '../src/lib/drafts.js';
import { setStorageUser } from '../src/lib/account-storage.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); setStorageUser({ uuid: 'alice' }); });
afterEach(() => { vi.restoreAllMocks(); });

const bookParses = (spy) => spy.mock.calls.filter(([text]) => typeof text === 'string' && text.includes('"workbook"')).length;

function draftOf(name, path = null, text = 'x') {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, text);
  const key = draftKey(path, name);
  expect(saveDraft(key, wb, name, `rev-${name}`)).toBe(true);
  return key;
}

// Listing the drafts parsed every one of them in full, book and all, and recovering one listed them
// again before parsing it a second time: with a few large drafts the home screen paid for it on every render.
it('lists drafts by reading their heads, without parsing a single book', () => {
  const plan = draftOf('Unfinished "plan" \\ with éscapes');
  const budget = draftOf('Budget', 'Spreadsheets/Budget.xlsx');
  const parse = vi.spyOn(JSON, 'parse');
  const listed = listDrafts();
  expect(bookParses(parse)).toBe(0);
  expect(listed.map((d) => [d.key, d.path, d.name])).toEqual(expect.arrayContaining([
    [plan, null, 'Unfinished "plan" \\ with éscapes'],
    [budget, 'Spreadsheets/Budget.xlsx', 'Budget'],
  ]));
  expect(listed.every((d) => Number.isFinite(d.savedAt))).toBe(true);
});

it('still lists a draft written with its fields in another order, by reading the whole of it', () => {
  const key = draftKey(null, 'Older');
  localStorage.setItem(key, JSON.stringify({ name: 'Older', workbook: { sheets: [{ name: 'Sheet1' }] }, savedAt: 1234 }));
  localStorage.setItem(draftKey(null, 'Broken'), '{"savedAt":5,"name":"Broken"');
  expect(listDrafts()).toEqual([{ key, path: null, name: 'Older', savedAt: 1234 }]);
});

it('recovers a draft by its key alone, parsing it once', () => {
  const key = draftOf('Recover me');
  draftOf('Another big one', null, 'y'.repeat(20000));
  const parse = vi.spyOn(JSON, 'parse');
  const doc = Doc.fromDraft(key);
  try {
    expect(doc.name).toBe('Recover me');
    expect(bookParses(parse)).toBe(1);
  } finally { doc.destroy(); }
});

it('refuses keys that are not this account\'s unsaved spreadsheets', () => {
  const file = draftOf('Budget', 'Spreadsheets/Budget.xlsx');
  expect(isUnsavedDraftKey(file)).toBe(false);
  expect(() => Doc.fromDraft(file)).toThrow('no longer available');
  const mine = draftOf('Mine');
  expect(isUnsavedDraftKey(mine)).toBe(true);
  setStorageUser({ uuid: 'bob' });
  expect(isUnsavedDraftKey(mine)).toBe(false);
  expect(() => Doc.fromDraft(mine)).toThrow('no longer available');
  expect(() => Doc.fromDraft(draftKey(null, 'Missing'))).toThrow('no longer available');
  expect(loadDraft(mine)).not.toBeNull();
});
