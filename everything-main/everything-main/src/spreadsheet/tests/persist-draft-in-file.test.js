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

const cellA1 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 0, 0);

async function savedFile() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  doc.destroy();
  await vi.advanceTimersByTimeAsync(2000);
  return doc.path;
}

/**
 * Edit an open file, then save with the tab closing while the write is in flight: the file
 * holds the edits, but the draft written for them was never cleared. `edits` are applied in
 * turn; the draft kept is the one written after the first of them.
 */
async function saveWithTabClosing(path, edits) {
  const doc = await Doc.fromPath(path);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, edits[0]);
  expect(doc.writeDraft()).toBe(true);
  const raw = localStorage.getItem(doc.draftKey);
  for (const edit of edits.slice(1)) doc.wb.setInput(doc.wb.activeSheetId, 0, 0, edit);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await doc.save()).toBe(true);
  doc.destroy();
  expect(loadDraft(draftKey(path))).toBeNull();
  localStorage.setItem(doc.draftKey, raw);
}

// The verdict on a draft went by modification time alone: a save that landed after the tab
// closed left a draft the file already held, offered on the next open as unsaved changes made
// before "the file has been saved since".
it('drops a draft whose edits the file already holds', async () => {
  const path = await savedFile();
  await saveWithTabClosing(path, ['typed, then saved']);
  const reopened = await Doc.fromPath(path);
  try {
    expect(cellA1(reopened)).toBe('typed, then saved');
    expect(reopened.recoverable).toBeNull();
    expect(loadDraft(draftKey(path))).toBeNull();
  } finally { reopened.destroy(); }
});

it('still offers a draft holding edits the file does not, saying the file was saved since', async () => {
  const path = await savedFile();
  await saveWithTabClosing(path, ['first', 'second']);
  const reopened = await Doc.fromPath(path);
  try {
    expect(cellA1(reopened)).toBe('second');
    expect(reopened.recoverable?.workbook.sheets[0].cells['0,0'].v).toBe('first');
    expect(reopened.recoverableMayBeOlder).toBe(true);
  } finally { reopened.destroy(); }
});

/** A document whose book is `wb`, saved as Budget.xlsx with a draft of the same state left behind. */
async function savedWithDraftLeftBehind(wb) {
  const doc = new Doc({ wb });
  await doc.rename('Budget');
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'typed, then saved');
  expect(doc.writeDraft()).toBe(true);
  const raw = localStorage.getItem(doc.draftKey);
  expect(await doc.save()).toBe(true);
  const { path } = doc;
  doc.destroy();
  localStorage.setItem(draftKey(path), raw); // the tab closed before the save cleared it
  return path;
}

// How far the grid reaches, and a width the file cannot tell from the default, never survive a save
// and a load: a session that had inserted one row could never again be told from what the file holds,
// so every reopening offered its own saved content back as older unsaved changes.
it('drops a draft the file holds although the session changed the grid extent or set a default-sized width', async () => {
  const cases = [
    ['a row insert', (wb) => wb.insertRows(wb.activeSheetId, 0, 1)],
    ['a column insert', (wb) => wb.insertCols(wb.activeSheetId, 0, 1)],
    ['a row delete', (wb) => wb.deleteRows(wb.activeSheetId, 5, 1)],
    ['an entry far to the right', (wb) => wb.setInput(wb.activeSheetId, 0, 52, 'far')],
  ];
  for (const [what, edit] of cases) {
    const wb = new Workbook();
    edit(wb);
    const path = await savedWithDraftLeftBehind(wb);
    const reopened = await Doc.fromPath(path);
    try {
      expect([what, reopened.recoverable]).toEqual([what, null]);
      expect(loadDraft(draftKey(path))).toBeNull();
    } finally { reopened.destroy(); }
  }
  // A template's column width of exactly the default is dropped when the file is read back.
  const path = await savedWithDraftLeftBehind(new Workbook({ sheets: [{ name: 'Sheet1', cells: {}, colWidths: { 1: 100 }, rowHeights: { 1: 26 } }] }));
  const reopened = await Doc.fromPath(path);
  try {
    expect(reopened.recoverable).toBeNull();
  } finally { reopened.destroy(); }
});

it('tells books apart by their content, not by the order of edits or the ids a load mints', () => {
  const a = new Workbook();
  a.setInput(a.activeSheetId, 5, 2, 'later');
  a.setInput(a.activeSheetId, 0, 0, 'first');
  const b = new Workbook();
  b.setInput(b.activeSheetId, 0, 0, 'first');
  b.setInput(b.activeSheetId, 5, 2, 'later');
  expect(a.toJSON().sheets[0].id).not.toBe(b.toJSON().sheets[0].id);
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(true);
  b.setInput(b.activeSheetId, 5, 2, 'changed');
  expect(sameBook(a.toJSON(), b.toJSON())).toBe(false);
  expect(sameBook(a.toJSON(), null)).toBe(false);
});
