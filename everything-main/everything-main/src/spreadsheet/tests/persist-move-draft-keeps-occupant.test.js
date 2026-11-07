import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, saveDraft, loadDraft, moveDraft, listDrafts } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const PATH = 'Spreadsheets/Budget.xlsx';
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;
/** Every draft as the home screen lists it: [name, path, first cell]. */
const listed = () => listDrafts().map((d) => [d.name, d.path, text(loadDraft(d.key))]).sort();

function book(value) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  return wb;
}

/** Budget.xlsx, saved, then edited offline and closed: the edits are kept here as its draft. Then the file is deleted elsewhere. */
async function deletedFileWithDraft() {
  const original = Doc.blank();
  original.wb.setInput(original.wb.activeSheetId, 0, 0, 'saved');
  await original.rename('Budget');
  expect(await original.save()).toBe(true);
  expect(original.path).toBe(PATH);
  original.wb.setInput(original.wb.activeSheetId, 0, 0, 'never saved');
  expect(original.writeDraft()).toBe(true);
  original.destroy();
  mock.fs.delete(PATH);
  expect(text(loadDraft(draftKey(PATH)))).toBe('never saved');
}

// A new spreadsheet saved under the name of a file deleted elsewhere took over that file's address, and
// with it the draft of edits the file's owner had never managed to save: the new document's draft was
// moved over it, then cleared once the save landed, and the home screen listed nothing.
it('keeps the deleted file\'s draft as an unsaved spreadsheet when a new spreadsheet takes the file\'s name', async () => {
  await deletedFileWithDraft();
  const doc = Doc.blank();
  await doc.rename('Budget');
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'the new Budget');
  try {
    await vi.advanceTimersByTimeAsync(2000);
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe(PATH);
    expect(loadDraft(draftKey(PATH))).toBeNull(); // the new document's own draft is gone, as after any save
    expect(listed()).toEqual([['Budget', null, 'never saved']]);
  } finally { doc.destroy(); }
});

it('parks a different draft found at the destination of a move rather than writing over it, and still gives way for the same snapshot or an unreadable one', () => {
  const from = draftKey('Spreadsheets/A.xlsx');
  const to = draftKey('Spreadsheets/B.xlsx');
  expect(saveDraft(from, book('A'), 'A', 'rev-a')).toBe(true);
  expect(saveDraft(to, book('B'), 'B', 'rev-b')).toBe(true);
  moveDraft(from, to);
  expect(loadDraft(from)).toBeNull();
  expect(text(loadDraft(to))).toBe('A');
  expect(listed()).toEqual([['A', 'Spreadsheets/B.xlsx', 'A'], ['B', null, 'B']]);
  // The same snapshot already at the destination (another tab moved it first): nothing to keep apart.
  const again = draftKey('Spreadsheets/C.xlsx');
  localStorage.setItem(again, localStorage.getItem(to));
  moveDraft(to, again);
  expect(loadDraft(to)).toBeNull();
  expect(text(loadDraft(again))).toBe('A');
  expect(listed()).toEqual([['A', 'Spreadsheets/C.xlsx', 'A'], ['B', null, 'B']]);
  // A record at the destination that is not a readable draft is not worth keeping.
  const garbage = draftKey('Spreadsheets/D.xlsx');
  localStorage.setItem(garbage, JSON.stringify({ savedAt: 1, name: 'D', workbook: 'not a book' }));
  moveDraft(again, garbage);
  expect(text(loadDraft(garbage))).toBe('A');
  expect(listed()).toEqual([['A', 'Spreadsheets/D.xlsx', 'A'], ['B', null, 'B']]);
  // A revision that does not match still leaves the source where it is, destination untouched.
  moveDraft(garbage, to, 'rev-other');
  expect(text(loadDraft(garbage))).toBe('A');
  expect(loadDraft(to)).toBeNull();
});
