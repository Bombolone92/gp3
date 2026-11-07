import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft, sameBook } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const cellA2 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 1, 0);

/** A book with a table made in the session (not loaded from a file). */
function withTable(wb) {
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Item');
  wb.setInput(id, 1, 0, 'a');
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 })).not.toBeNull();
  return wb;
}

it('holds a book with a table made in the session to be the same as the book a load gives back', () => {
  const wb = withTable(new Workbook());
  const loaded = new Workbook(wb.toJSON());
  expect(loaded.toJSON().sheets[0].tables[0]).toHaveProperty('calc');
  expect(sameBook(wb.toJSON(), loaded.toJSON())).toBe(true);
  expect(sameBook(loaded.toJSON(), new Workbook(loaded.toJSON()).toJSON())).toBe(true);
  // A table whose calculated columns differ is another book.
  const other = new Workbook(wb.toJSON());
  const sheet = other.sheets[0];
  other._setTables(sheet, sheet.tables.map((t) => ({ ...t, calc: { 0: '=1' } })), 'Edit');
  expect(sameBook(wb.toJSON(), other.toJSON())).toBe(false);
});

// Every table a load gives back carries an empty map of calculated columns that a table made in the
// session has not, so a save that landed as the tab closed (before the draft was cleared) left a draft
// that compared as different from the file and was offered again as "older" unsaved changes,
// for content that is byte for byte what the file holds.
it('drops a draft whose edits the file already holds when the book has a table', async () => {
  const doc = Doc.blank();
  withTable(doc.wb);
  await doc.rename('Stock');
  expect(await doc.save()).toBe(true);
  const path = doc.path;
  doc.destroy();
  await vi.advanceTimersByTimeAsync(2000);
  // Edit, then save with the tab closing while the write is in flight: the file holds the edit, the draft stays.
  const open = await Doc.fromPath(path);
  open.wb.setInput(open.wb.activeSheetId, 1, 0, 'b');
  expect(open.writeDraft()).toBe(true);
  const raw = localStorage.getItem(open.draftKey);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await open.save()).toBe(true);
  open.destroy();
  localStorage.setItem(open.draftKey, raw);
  const reopened = await Doc.fromPath(path);
  try {
    expect(cellA2(reopened)).toBe('b');
    expect(reopened.recoverable).toBeNull();
    expect(loadDraft(draftKey(path))).toBeNull();
  } finally { reopened.destroy(); }
});
