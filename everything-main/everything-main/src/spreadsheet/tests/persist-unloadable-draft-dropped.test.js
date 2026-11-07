import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, saveDraft, loadDraft, listDrafts, moveDraft, parkDraft, readableDraft } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

/** A draft record as this app writes one, holding `workbook` as its book. */
const record = (workbook) => ({ savedAt: Date.now(), name: 'Plan', version: 3, revision: 'r1', external: true, workbook });
const put = (key, workbook) => localStorage.setItem(key, JSON.stringify(record(workbook)));
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;

// A record was readable once it had a non-empty sheet list and a name: one holding a null sheet, or
// a sheet without cells, was parked and listed as an unsaved spreadsheet, and recovering it failed in
// the workbook's loader every time, with a raw error and the record left in place.
it('reads a draft only when every sheet is an object with a cells map', () => {
  const good = new Workbook();
  good.setInput(good.activeSheetId, 0, 0, 'ok');
  expect(readableDraft(record(good.toJSON()))).toBe(true);
  expect(readableDraft(record({ sheets: [{ cells: {} }] }))).toBe(true);
  for (const workbook of [{ sheets: [null] }, { sheets: [{}] }, { sheets: [{ cells: [] }] }, { sheets: [{ cells: 'a1' }] }, { sheets: [{ cells: {} }, 5] }, { sheets: [] }, { sheets: 'Sheet1' }, 'not a book']) {
    expect(readableDraft(record(workbook)), JSON.stringify(workbook)).toBe(false);
  }
});

it('neither parks nor gives way to a record with a null sheet', () => {
  const garbage = draftKey('Spreadsheets/Garbage.xlsx');
  put(garbage, { sheets: [null] });
  expect(parkDraft(garbage)).toBeNull();
  expect(loadDraft(garbage)).not.toBeNull(); // left where it is, for its own file's open to drop
  const from = draftKey('Spreadsheets/A.xlsx');
  const a = new Workbook();
  a.setInput(a.activeSheetId, 0, 0, 'A');
  expect(saveDraft(from, a, 'A', 'rev-a')).toBe(true);
  moveDraft(from, garbage);
  expect(text(loadDraft(garbage))).toBe('A');
  expect(listDrafts().map((d) => d.path)).toEqual(['Spreadsheets/Garbage.xlsx']);
});

it('drops an unsaved spreadsheet whose record cannot be read or loaded, with an error the route can show', () => {
  const nullSheet = draftKey(null, 'Plan', undefined, 'one');
  put(nullSheet, { sheets: [null] });
  expect(() => Doc.fromDraft(nullSheet)).toThrow('Could not read the unsaved spreadsheet');
  expect(loadDraft(nullSheet)).toBeNull();
  // Readable by its shape, but the workbook's loader refuses it.
  const badMerges = draftKey(null, 'Plan', undefined, 'two');
  put(badMerges, { sheets: [{ cells: {}, merges: 5 }] });
  expect(() => new Workbook({ sheets: [{ cells: {}, merges: 5 }] })).toThrow();
  expect(() => Doc.fromDraft(badMerges)).toThrow('Could not read the unsaved spreadsheet');
  expect(loadDraft(badMerges)).toBeNull();
  expect(listDrafts()).toEqual([]);
  // A missing record is reported as before.
  expect(() => Doc.fromDraft(draftKey(null, 'Plan', undefined, 'three'))).toThrow('no longer available');
});

it('reports a lost file as missing when the draft kept for it cannot be loaded, dropping that draft', async () => {
  const path = 'Spreadsheets/Gone.xlsx';
  put(draftKey(path), { sheets: [{ cells: {}, merges: 5 }] });
  await expect(Doc.fromPath(path)).rejects.toMatchObject({ code: 'subject_does_not_exist' });
  expect(loadDraft(draftKey(path))).toBeNull();
});
