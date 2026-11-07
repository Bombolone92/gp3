import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, liveDraftKey, saveDraft, loadDraft } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const PATH = 'Spreadsheets/Budget.xlsx';
const MOVED = 'Spreadsheets/Plan.xlsx';
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;

/** Storage refuses the record under `refused` (full, say), and takes everything else. */
function refuseKey(refused) {
  const setItem = localStorage.setItem;
  localStorage.setItem = (key, value) => { if (key === refused) throw new Error('QuotaExceededError'); return setItem(key, value); };
}

/** A blank file on the drive with a draft of edits that never reached Puter waiting under its key, opened with the draft offered. */
async function openWithDraft() {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  const old = new Workbook();
  old.setInput(old.activeSheetId, 0, 0, 'recovered edits');
  expect(saveDraft(draftKey(PATH), old, 'Budget', 'rev-old')).toBe(true);
  const doc = await Doc.fromPath(PATH);
  expect(text(doc.recoverable)).toBe('recovered edits');
  return doc;
}

// When storage refused the record under the new name, the recovered draft stayed under the old one,
// but the document took the new key for its address: discarding the offer cleared nothing, and the
// draft was offered again under the old name for good.
it('keeps the recovered draft\'s key when the move at a rename fails, so discarding it clears the draft where it is', async () => {
  const doc = await openWithDraft();
  refuseKey(draftKey(MOVED));
  try {
    expect(await doc.rename('Plan')).toBeNull();
    expect(doc.path).toBe(MOVED);
    expect(text(loadDraft(draftKey(PATH)))).toBe('recovered edits');
    expect(loadDraft(draftKey(MOVED))).toBeNull();
    doc.discardDraft();
    expect(doc.recoverable).toBeNull();
    expect(loadDraft(draftKey(PATH))).toBeNull();
    expect(loadDraft(draftKey(MOVED))).toBeNull();
  } finally { doc.destroy(); }
});

it('still follows the draft to the new key when the move succeeds', async () => {
  const doc = await openWithDraft();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'meanwhile');
  expect(doc.writeDraft()).toBe(true);
  try {
    expect(await doc.rename('Plan')).toBeNull();
    expect(text(loadDraft(draftKey(MOVED)))).toBe('recovered edits');
    expect(text(loadDraft(liveDraftKey(draftKey(MOVED))))).toBe('meanwhile');
    doc.discardDraft();
    expect(loadDraft(draftKey(PATH))).toBeNull();
    expect(text(loadDraft(draftKey(MOVED)))).toBe('meanwhile');
  } finally { doc.destroy(); }
});
