import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, saveDraft, loadDraft, listDrafts } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const text = (json) => json?.sheets[0].cells['0,0'].v;

/** A saved file with a draft of later edits that never reached Puter, as a closed tab leaves behind. */
async function fileWithDraft() {
  const original = Doc.blank();
  original.wb.setInput(original.wb.activeSheetId, 0, 0, 'saved');
  await original.rename('Budget');
  await original.save();
  original.wb.setInput(original.wb.activeSheetId, 0, 0, 'never saved');
  expect(original.writeDraft()).toBe(true);
  original.destroy();
  const path = original.path;
  expect(loadDraft(draftKey(path)).fileUid).toBe(mock.fs.get(path).uid);
  return path;
}

// A draft of a file deleted elsewhere sat in local storage for good: opening the file failed with
// "That file no longer exists", the home screen listed only drafts of spreadsheets without a file,
// and recovery refused a draft keyed by a path.
it('opens the edits made to a file since deleted elsewhere as a new spreadsheet', async () => {
  const path = await fileWithDraft();
  mock.fs.delete(path);
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.path).toBeNull();
    expect(doc.name).toBe('Budget');
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('never saved');
    expect(doc.wb.dirty).toBe(true);
    expect(doc.recoverable).toBeNull();
    // The draft is an unsaved spreadsheet's now: the home screen lists it should this tab close too.
    expect(loadDraft(draftKey(path))).toBeNull();
    expect(listDrafts().map((d) => [d.key, d.path])).toEqual([[doc.draftKey, null]]);
    expect(text(loadDraft(doc.draftKey).workbook)).toBe('never saved');
    // It saves like any new spreadsheet, and the draft goes once the file holds the edits.
    await vi.advanceTimersByTimeAsync(2000);
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe('Spreadsheets/Budget.xlsx');
    expect(listDrafts()).toEqual([]);
  } finally { doc.destroy(); }
});

it('follows a file renamed elsewhere to where it is now and offers the draft there', async () => {
  const path = await fileWithDraft();
  await puter.fs.rename(path, 'Plan.xlsx');
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.path).toBe('Spreadsheets/Plan.xlsx');
    expect(doc.name).toBe('Plan');
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('saved');
    expect(text(doc.recoverable?.workbook)).toBe('never saved');
    expect(loadDraft(draftKey(path))).toBeNull();
    expect(text(loadDraft(draftKey('Spreadsheets/Plan.xlsx')).workbook)).toBe('never saved');
    expect(doc.restoreDraft()).toBe(true);
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('never saved');
  } finally { doc.destroy(); }
});

it('recovers a draft written before the file id was kept as a new spreadsheet', async () => {
  const path = 'Spreadsheets/Old.xlsx';
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'from an older draft');
  expect(saveDraft(draftKey(path), wb, 'Old', 'rev-1')).toBe(true);
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.path).toBeNull();
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('from an older draft');
  } finally { doc.destroy(); }
});

it('still reports a missing file that has no draft, and other failures as they are', async () => {
  await expect(Doc.fromPath('Spreadsheets/Nothing.xlsx')).rejects.toMatchObject({ code: 'subject_does_not_exist' });
  const path = await fileWithDraft();
  puter.fs.read = async () => { throw new Error('network down'); };
  puter.fs.stat = async () => { throw new Error('network down'); };
  await expect(Doc.fromPath(path)).rejects.toThrow('network down');
  expect(loadDraft(draftKey(path))).not.toBeNull();
});
