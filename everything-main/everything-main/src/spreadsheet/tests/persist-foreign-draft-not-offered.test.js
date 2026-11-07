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

const PATH = 'Spreadsheets/Budget.xlsx';
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;
const cellA1 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 0, 0);
/** Every draft as the home screen lists it: [name, path, first cell]. */
const listed = () => listDrafts().map((d) => [d.name, d.path, text(loadDraft(d.key))]).sort();

/** The new Budget.xlsx on the drive, with a draft of edits to the old Budget.xlsx, deleted since, still kept under that address. */
async function newFileAtOldAddress() {
  const fresh = Doc.blank();
  fresh.wb.setInput(fresh.wb.activeSheetId, 0, 0, 'the NEW Budget');
  await fresh.rename('Budget');
  expect(await fresh.save()).toBe(true);
  fresh.destroy();
  const old = new Workbook();
  old.setInput(old.activeSheetId, 0, 0, 'edits to the OLD Budget');
  expect(saveDraft(draftKey(PATH), old, 'Budget', 'rev-old', { fileModified: 1, fileUid: 'uid-old-file' })).toBe(true);
  expect(mock.fs.get(PATH).uid).not.toBe('uid-old-file');
}

// A draft compared only the file's time and content with its own, never the file's id: edits kept for a
// file deleted elsewhere were offered as unsaved changes of whatever file later took its address, and
// restoring them replaced that file's contents with the old edits.
it('does not offer another file\'s draft for the file now at that address, and keeps it as an unsaved spreadsheet', async () => {
  await newFileAtOldAddress();
  const doc = await Doc.fromPath(PATH);
  try {
    expect(doc.recoverable).toBeNull();
    expect(doc.recoverableMayBeOlder).toBe(false);
    expect(cellA1(doc)).toBe('the NEW Budget');
    expect(loadDraft(draftKey(PATH))).toBeNull();
    expect(listed()).toEqual([['Budget', null, 'edits to the OLD Budget']]);
    // The new file's own drafting is not in the way of the kept one.
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited');
    expect(doc.writeDraft()).toBe(true);
    expect(text(loadDraft(draftKey(PATH)))).toBe('edited');
    expect(listed()).toEqual([['Budget', null, 'edits to the OLD Budget'], ['Budget', PATH, 'edited']]);
  } finally { doc.destroy(); }
});

it('still offers a draft made for this very file, by id', async () => {
  const fresh = Doc.blank();
  fresh.wb.setInput(fresh.wb.activeSheetId, 0, 0, 'saved');
  await fresh.rename('Budget');
  expect(await fresh.save()).toBe(true);
  fresh.wb.setInput(fresh.wb.activeSheetId, 0, 0, 'never saved');
  expect(fresh.writeDraft()).toBe(true);
  fresh.destroy();
  expect(loadDraft(draftKey(PATH)).fileUid).toBe(mock.fs.get(PATH).uid);
  const doc = await Doc.fromPath(PATH);
  try {
    expect(text(doc.recoverable)).toBe('never saved');
    expect(listed()).toEqual([['Budget', PATH, 'never saved']]);
  } finally { doc.destroy(); }
});
