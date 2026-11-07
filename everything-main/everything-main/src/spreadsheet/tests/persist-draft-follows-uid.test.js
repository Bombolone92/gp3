import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft, listDrafts, saveDraft } from '../src/lib/drafts.js';
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
async function fileWithDraft(name = 'Budget') {
  const original = Doc.blank();
  original.wb.setInput(original.wb.activeSheetId, 0, 0, 'saved');
  await original.rename(name);
  await original.save();
  original.wb.setInput(original.wb.activeSheetId, 0, 0, `never saved in ${name}`);
  expect(original.writeDraft()).toBe(true);
  original.destroy();
  return original.path;
}

// A draft was looked up by the file's address alone. Renamed or moved elsewhere meanwhile, the file
// opened under its new name with nothing offered, while the draft sat under the old address for good
// (the home screen listed the file under its new name only, so nothing led back to the edits).
it('offers the draft of a file renamed elsewhere when the file is opened under its new name', async () => {
  const path = await fileWithDraft();
  await fileWithDraft('Other'); // another file's draft must not be taken for it
  await puter.fs.rename(path, 'Q3.xlsx');
  const doc = await Doc.fromPath('Spreadsheets/Q3.xlsx');
  try {
    expect(doc.uid).toBe(mock.fs.get('Spreadsheets/Q3.xlsx').uid);
    expect(text(doc.recoverable?.workbook)).toBe('never saved in Budget');
    expect(loadDraft(draftKey(path))).toBeNull();
    expect(text(loadDraft(draftKey('Spreadsheets/Q3.xlsx')).workbook)).toBe('never saved in Budget');
    expect(listDrafts().map((d) => d.path).sort()).toEqual(['Spreadsheets/Other.xlsx', 'Spreadsheets/Q3.xlsx']);
    expect(doc.restoreDraft()).toBe(true);
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('never saved in Budget');
  } finally { doc.destroy(); }
});

it('leaves a draft kept under the new address alone, and one of a draft written before file ids were kept where it is', async () => {
  const path = await fileWithDraft();
  await puter.fs.rename(path, 'Q3.xlsx');
  const newer = new Workbook();
  newer.setInput(newer.activeSheetId, 0, 0, 'drafted under the new name');
  expect(saveDraft(draftKey('Spreadsheets/Q3.xlsx'), newer, 'Q3', 'rev-new', { fileModified: 1 })).toBe(true);
  const doc = await Doc.fromPath('Spreadsheets/Q3.xlsx');
  try {
    expect(text(doc.recoverable?.workbook)).toBe('drafted under the new name');
    expect(text(loadDraft(draftKey(path)).workbook)).toBe('never saved in Budget');
  } finally { doc.destroy(); }
  const old = new Workbook();
  old.setInput(old.activeSheetId, 0, 0, 'from before ids were kept');
  const legacy = 'Spreadsheets/Legacy.xlsx';
  expect(saveDraft(draftKey(legacy), old, 'Legacy', 'rev-legacy')).toBe(true);
  await puter.fs.write('Spreadsheets/Fresh.xlsx', await Doc.blank().toXlsxBlob());
  const fresh = await Doc.fromPath('Spreadsheets/Fresh.xlsx');
  try {
    expect(fresh.recoverable).toBeNull();
    expect(loadDraft(draftKey(legacy))).not.toBeNull();
  } finally { fresh.destroy(); }
});

// A record left by another file at the address a rename elsewhere gave this one kept the file's own
// edits from following it: they were offered on no open, listed under no name, and cleaned up never.
it('moves the draft of a file renamed elsewhere onto an address a stranger\'s record holds', async () => {
  const path = await fileWithDraft();
  // A stale record of a since-deleted Q3.xlsx sits where the rename puts the file.
  const stranger = new Workbook();
  stranger.setInput(stranger.activeSheetId, 0, 0, 'a stranger');
  expect(saveDraft(draftKey('Spreadsheets/Q3.xlsx'), stranger, 'Q3', 'rev-gone', { fileUid: 'uid-gone' })).toBe(true);
  await puter.fs.rename(path, 'Q3.xlsx');
  const doc = await Doc.fromPath('Spreadsheets/Q3.xlsx');
  try {
    expect(text(doc.recoverable?.workbook)).toBe('never saved in Budget');
    expect(loadDraft(draftKey(path))).toBeNull();
    expect(text(loadDraft(draftKey('Spreadsheets/Q3.xlsx')).workbook)).toBe('never saved in Budget');
    // The stranger's record is kept as an unsaved spreadsheet of its own, which the home screen lists.
    expect(listDrafts().map((d) => `${d.name} at ${d.path}`).sort()).toEqual(['Budget at Spreadsheets/Q3.xlsx', 'Q3 at null']);
  } finally { doc.destroy(); }
});

it('lists the file id a draft was made for', async () => {
  const path = await fileWithDraft();
  const listed = listDrafts();
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ path, name: 'Budget', fileUid: mock.fs.get(path).uid });
  const unsaved = Doc.blank();
  unsaved.wb.setInput(unsaved.wb.activeSheetId, 0, 0, 'no file yet');
  expect(unsaved.writeDraft()).toBe(true);
  expect(listDrafts().find((d) => d.path === null).fileUid).toBeUndefined();
  unsaved.destroy();
});
