import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, liveDraftKey, loadDraft, saveDraft } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// A draft this browser kept for a file is compared with the file when it is opened. A draft
// whose book was damaged in storage, or written in a shape this code cannot read, made the
// comparison throw out of the opening, so the file could not be opened at all, on every attempt,
// until the record was removed by hand. Such a draft is dropped now, and the file opens.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

async function savedFile() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Plan');
  expect(await doc.save()).toBe(true);
  doc.destroy();
  await vi.advanceTimersByTimeAsync(2000);
  return doc.path;
}
/** A draft record as this app writes one, holding `workbook` as its book. */
const record = (workbook) => JSON.stringify({ savedAt: Date.now(), name: 'Plan', version: 3, revision: 'r1', fileModified: 1, external: true, workbook });

it.each([
  ['a sheet that is null', { sheets: [null] }],
  ['text in place of the book', 'not a book'],
  ['sheets that are not a list', { sheets: 'Sheet1' }],
  ['no sheets at all', { sheets: [] }],
])('opens the file and drops the draft when the draft holds %s', async (_, workbook) => {
  const path = await savedFile();
  const key = draftKey(path);
  localStorage.setItem(key, record(workbook));
  expect(loadDraft(key)).not.toBeNull();
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('saved');
    expect(doc.recoverable).toBeNull();
    expect(loadDraft(key)).toBeNull();
  } finally { doc.destroy(); }
});

it('still offers the readable draft kept beside an unreadable one', async () => {
  const path = await savedFile();
  const key = draftKey(path);
  localStorage.setItem(key, record({ sheets: [null] }));
  // Edits made while an earlier draft awaited a decision are kept beside it, and are the draft once it is gone.
  const edited = new Workbook();
  edited.setInput(edited.activeSheetId, 0, 0, 'unsaved edit');
  expect(saveDraft(liveDraftKey(key), edited, 'Plan', 'r2', { fileModified: 1 })).toBe(true);
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('saved');
    expect(doc.recoverable?.workbook.sheets[0].cells['0,0'].v).toBe('unsaved edit');
    expect(loadDraft(liveDraftKey(key))).toBeNull();
  } finally { doc.destroy(); }
});
