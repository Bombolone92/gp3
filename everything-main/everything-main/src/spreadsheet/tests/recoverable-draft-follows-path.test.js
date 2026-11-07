import { afterEach, beforeEach, expect, it } from 'vitest';
import { draftKey, saveDraft, loadDraft } from '../src/lib/drafts.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

/** A file in the folder, older than any draft, with a draft of unsaved edits waiting under its key. */
async function fileWithDraft(path) {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(path, { blob: bytes, size: bytes.size, modified: 1 });
  const precious = new Workbook();
  precious.setInput(precious.activeSheetId, 0, 0, 'never saved');
  expect(saveDraft(draftKey(path), precious, Doc.nameFor(path), 'rev-1')).toBe(true);
}
const text = (draft) => draft?.workbook.sheets[0].cells['0,0'].v;

// A draft offered on open awaits a decision under the file's key. Renaming or saving under
// another name moved only drafts of this document's own edits, so the offered one stayed
// behind under the old path, where discarding could not find it and the next file of that
// name would be offered it instead.
it('moves an undecided draft with the file when it is renamed, and discards it from there', async () => {
  await fileWithDraft('Spreadsheets/Budget.xlsx');
  const doc = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  expect(text(doc.recoverable)).toBe('never saved');
  expect(await doc.rename('Plan')).toBeNull();
  expect(loadDraft(draftKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect(text(loadDraft(draftKey('Spreadsheets/Plan.xlsx')))).toBe('never saved');
  expect(text(doc.recoverable)).toBe('never saved');
  doc.discardDraft();
  expect(doc.recoverable).toBeNull();
  expect(loadDraft(draftKey('Spreadsheets/Plan.xlsx'))).toBeNull();
  // Drafting resumes under the new key.
  doc.wb.setInput(doc.wb.activeSheetId, 1, 1, 'fresh');
  expect(doc.writeDraft()).toBe(true);
  expect(loadDraft(draftKey('Spreadsheets/Plan.xlsx')).workbook.sheets[0].cells['1,1'].v).toBe('fresh');
  doc.destroy();
});

it('keeps an undecided draft with the document across a save under another name, and restores it from there', async () => {
  await fileWithDraft('Spreadsheets/Budget.xlsx');
  const doc = await Doc.fromPath('Spreadsheets/Budget.xlsx');
  expect(await doc.saveAs('Copy')).toBeNull();
  expect(doc.path).toBe('Spreadsheets/Copy.xlsx');
  expect(loadDraft(draftKey('Spreadsheets/Budget.xlsx'))).toBeNull();
  expect(text(loadDraft(draftKey('Spreadsheets/Copy.xlsx')))).toBe('never saved');
  expect(doc.restoreDraft()).toBe(true);
  expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('never saved');
  expect(await doc.save()).toBe(true);
  expect(loadDraft(draftKey('Spreadsheets/Copy.xlsx'))).toBeNull();
  doc.destroy();
});
