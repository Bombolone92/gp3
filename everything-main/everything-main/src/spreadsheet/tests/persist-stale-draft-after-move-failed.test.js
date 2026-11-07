import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft, listDrafts } from '../src/lib/drafts.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

/** Storage refuses the record under `refused` (full, say), and takes everything else. */
function refuseKey(refused) {
  const setItem = localStorage.setItem;
  localStorage.setItem = (key, value) => { if (key === refused) throw new Error('QuotaExceededError'); return setItem(key, value); };
}

// When the draft could not follow the file at its first save (storage refused the record under the new
// address), the save still went through and the book was clean, but the draft stayed under the unsaved
// spreadsheet's key: the home screen listed an "unsaved spreadsheet" for a file that was saved, and
// recovering it opened a second, unsaved copy.
it('clears the unsaved spreadsheet\'s draft once its first save lands, even when the draft could not follow the file', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'first words');
  await doc.rename('Budget');
  expect(doc.writeDraft()).toBe(true);
  const oldKey = doc.draftKey;
  expect(listDrafts().map((d) => d.path)).toEqual([null]);
  refuseKey(draftKey('Spreadsheets/Budget.xlsx'));
  try {
    expect(await doc.save()).toBe(true);
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe('Spreadsheets/Budget.xlsx');
    expect(loadDraft(oldKey)).toBeNull();
    expect(listDrafts()).toEqual([]);
  } finally { doc.destroy(); }
});

it('clears the draft under the old name once a copy saved under a new name holds the book, even when the draft could not follow', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited');
  expect(doc.writeDraft()).toBe(true);
  expect(listDrafts().map((d) => d.path)).toEqual(['Spreadsheets/Budget.xlsx']);
  refuseKey(draftKey('Spreadsheets/Copy.xlsx'));
  try {
    expect(await doc.saveAs('Copy')).toBeNull();
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe('Spreadsheets/Copy.xlsx');
    expect(listDrafts()).toEqual([]);
  } finally { doc.destroy(); }
});
