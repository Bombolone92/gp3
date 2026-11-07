import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft, sameBook } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };
/** Edits whose number format the .xlsx round trip spells out in more keys than the session wrote, and controls that it keeps as they are. */
const edits = [
  ['Currency from the toolbar', (wb, id) => { wb.setInput(id, 0, 0, '1234.5'); wb.applyStyle(id, A1, { fmt: 'currency' }); }],
  ['Number with one decimal', (wb, id) => { wb.setInput(id, 0, 0, '1234.5'); wb.applyStyle(id, A1, { fmt: 'number', dec: 1 }); }],
  ['a typed 1,234.5', (wb, id) => { wb.setInput(id, 0, 0, '1,234.5'); }],
  ['bold and Currency together', (wb, id) => { wb.setInput(id, 0, 0, '1234.5'); wb.applyStyle(id, A1, { bold: true }); wb.applyStyle(id, A1, { fmt: 'currency' }); }],
  ['Percent', (wb, id) => { wb.setInput(id, 0, 0, '0.5'); wb.applyStyle(id, A1, { fmt: 'percent', dec: 0 }); }],
  ['a typed date', (wb, id) => { wb.setInput(id, 0, 0, '2026-09-15'); }],
  ['bold', (wb, id) => { wb.setInput(id, 0, 0, 'x'); wb.applyStyle(id, A1, { bold: true }); }],
];

// The .xlsx round trip writes a number format as its code and the loader keeps that spelling: { fmt: 'currency' }
// came back as { fmt: 'currency', cur: 'USD', dec: 2 } and a Number cell with group: true, so a draft written
// for such a cell never compared equal to the file that held it, and a save that landed as the tab closed
// left "Unsaved changes found" on the next open, for content the file had.
it.each(edits)('holds a book whose cell was given %s to be the same book once saved and loaded again', async (_, edit) => {
  const wb = new Workbook();
  edit(wb, wb.activeSheetId);
  const loaded = await workbookFromFile(await workbookToXlsx(wb), 'Book.xlsx');
  expect(loaded.getDisplay(loaded.activeSheetId, 0, 0)).toBe(wb.getDisplay(wb.activeSheetId, 0, 0));
  expect(sameBook(wb.toJSON(), loaded.toJSON())).toBe(true);
  expect(sameBook(loaded.toJSON(), wb.toJSON())).toBe(true);
});

it.each(edits)('drops a draft whose edits the file already holds when the edit was %s', async (_, edit) => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  const path = doc.path;
  doc.destroy();
  await vi.advanceTimersByTimeAsync(2000);
  // Edit, then save with the tab closing while the write is in flight: the file holds the edit, the draft stays.
  const open = await Doc.fromPath(path);
  edit(open.wb, open.wb.activeSheetId);
  expect(open.writeDraft()).toBe(true);
  const raw = localStorage.getItem(open.draftKey);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await open.save()).toBe(true);
  open.destroy();
  localStorage.setItem(open.draftKey, raw);
  const reopened = await Doc.fromPath(path);
  try {
    expect(reopened.wb.getDisplay(reopened.wb.activeSheetId, 0, 0)).toBe(open.wb.getDisplay(open.wb.activeSheetId, 0, 0));
    expect(reopened.recoverable).toBeNull();
    expect(loadDraft(draftKey(path))).toBeNull();
  } finally { reopened.destroy(); }
});

it('still tells cells apart by the format they show', () => {
  const a = new Workbook();
  a.setInput(a.activeSheetId, 0, 0, '1234.5');
  a.applyStyle(a.activeSheetId, A1, { fmt: 'number', dec: 2 });
  const b = new Workbook(a.toJSON());
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(true);
  b.applyStyle(b.activeSheetId, A1, { dec: 1 });
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(false);
  b.applyStyle(b.activeSheetId, A1, { dec: 2, group: false });
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(false);
  b.applyStyle(b.activeSheetId, A1, { fmt: 'currency', group: null });
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(false);
});

it('compares palette defaults without ignoring custom palette changes', async () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'color');
  const loaded = await workbookFromFile(await workbookToXlsx(wb), 'Book.xlsx');
  expect(sameBook(wb.toJSON(), loaded.toJSON())).toBe(true);
  loaded.colorPalette.theme[4] = '#237864';
  expect(sameBook(wb.toJSON(), loaded.toJSON())).toBe(false);
  const copy = new Workbook(loaded.toJSON());
  expect(sameBook(copy.toJSON(), loaded.toJSON())).toBe(true);
  copy.colorPalette.indexed[2] = '#123456';
  expect(sameBook(copy.toJSON(), loaded.toJSON())).toBe(false);
});
