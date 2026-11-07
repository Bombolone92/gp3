import { afterEach, beforeEach, expect, it } from 'vitest';
import { draftKey, saveDraft, loadDraft } from '../src/lib/drafts.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

// The recovery prompt can be dismissed to decide later. The draft it offers
// lives under the document's own key, so the next edit's draft must not
// overwrite it, and a save must not clear it, until the user has decided.
it('keeps a recoverable draft intact while it awaits a decision', async () => {
  const path = 'Spreadsheets/Plan.xlsx';
  const precious = new Workbook();
  precious.setInput(precious.activeSheetId, 0, 0, 'EDITS THAT NEVER REACHED PUTER');
  const key = draftKey(path);
  expect(saveDraft(key, precious, 'Plan', 'rev-1')).toBe(true);

  const doc = new Doc({ name: 'Plan', path });
  doc.recoverable = loadDraft(key);
  expect(doc.recoverable).not.toBeNull();
  doc.wb.setInput(doc.wb.activeSheetId, 5, 5, 'new edit');
  expect(doc.writeDraft()).toBe(true); // drafted beside the offered one, not over it
  expect(loadDraft(key).workbook.sheets[0].cells['0,0'].v).toBe('EDITS THAT NEVER REACHED PUTER');
  expect(await doc.save()).toBe(true);
  expect(loadDraft(key).workbook.sheets[0].cells['0,0'].v).toBe('EDITS THAT NEVER REACHED PUTER');

  // Restoring later still finds those edits; afterwards drafting resumes as usual.
  expect(doc.restoreDraft()).toBe(true);
  expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('EDITS THAT NEVER REACHED PUTER');
  doc.wb.setInput(doc.wb.activeSheetId, 1, 1, 'after');
  expect(doc.writeDraft()).toBe(true);
  expect(loadDraft(key).workbook.sheets[0].cells['1,1'].v).toBe('after');
  doc.destroy();
});

it('drafts again once the recoverable draft is discarded', () => {
  const path = 'Spreadsheets/Other.xlsx';
  const old = new Workbook();
  old.setInput(old.activeSheetId, 0, 0, 'old');
  saveDraft(draftKey(path), old, 'Other', 'rev-1');
  const doc = new Doc({ name: 'Other', path });
  doc.recoverable = loadDraft(draftKey(path));
  doc.discardDraft();
  expect(loadDraft(draftKey(path))).toBeNull();
  doc.wb.setInput(doc.wb.activeSheetId, 2, 2, 'fresh');
  expect(doc.writeDraft()).toBe(true);
  expect(loadDraft(draftKey(path)).workbook.sheets[0].cells['2,2'].v).toBe('fresh');
  doc.destroy();
});
