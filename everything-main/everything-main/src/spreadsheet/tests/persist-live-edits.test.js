import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, liveDraftKey, saveDraft, loadDraft, listDrafts } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const PATH = 'Spreadsheets/Budget.xlsx';
const KEY = () => draftKey(PATH);
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;
const cellA1 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 0, 0);

/** A blank file on the drive with an older draft of edits that never reached Puter waiting under its key. */
async function fileWithDraft() {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  const old = new Workbook();
  old.setInput(old.activeSheetId, 0, 0, 'recovered edits');
  expect(saveDraft(KEY(), old, 'Budget', 'rev-old')).toBe(true);
}

/** The file open with its draft offered, and an edit made before deciding. */
async function openAndEdit() {
  const doc = await Doc.fromPath(PATH);
  expect(text(doc.recoverable)).toBe('recovered edits');
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'meanwhile');
  expect(doc.writeDraft()).toBe(true);
  return doc;
}

// Edits made while a recovered draft awaited a decision were not drafted at all, since the draft
// under the document's key was the one on offer: a closed tab lost them.
it('drafts edits made while a recovered draft awaits a decision beside it, and makes them the draft once it is discarded', async () => {
  await fileWithDraft();
  const doc = await openAndEdit();
  try {
    expect(text(loadDraft(KEY()))).toBe('recovered edits');
    expect(text(loadDraft(liveDraftKey(KEY())))).toBe('meanwhile');
    expect(listDrafts().filter((d) => d.path === null)).toEqual([]);
    doc.discardDraft();
    expect(text(loadDraft(KEY()))).toBe('meanwhile');
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(await doc.save()).toBe(true);
    expect(loadDraft(KEY())).toBeNull();
  } finally { doc.destroy(); }
});

it('lets the restored draft stand in for the edits made meanwhile', async () => {
  await fileWithDraft();
  const doc = await openAndEdit();
  try {
    expect(doc.restoreDraft()).toBe(true);
    expect(cellA1(doc)).toBe('recovered edits');
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(text(loadDraft(KEY()))).toBe('recovered edits');
    expect(await doc.save()).toBe(true);
    expect(loadDraft(KEY())).toBeNull();
  } finally { doc.destroy(); }
});

it('keeps the recovered draft on offer when the edits made meanwhile are saved', async () => {
  await fileWithDraft();
  const doc = await openAndEdit();
  try {
    expect(await doc.save()).toBe(true);
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(text(loadDraft(KEY()))).toBe('recovered edits');
    expect(text(doc.recoverable)).toBe('recovered edits');
    doc.wb.setInput(doc.wb.activeSheetId, 1, 1, 'more');
    expect(doc.writeDraft()).toBe(true);
    doc.wb.markClean();
    doc.writeDraft();
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    doc.destroy();
    expect(text(loadDraft(KEY()))).toBe('recovered edits');
  } finally { doc.destroy(); }
});

it('offers the edits made meanwhile on a later open, and keeps the recovered draft they were made beside as an unsaved spreadsheet', async () => {
  await fileWithDraft();
  const doc = await openAndEdit();
  doc.destroy(); // the tab closed before deciding, edits and all
  expect(text(loadDraft(KEY()))).toBe('recovered edits');
  expect(text(loadDraft(liveDraftKey(KEY())))).toBe('meanwhile');
  const again = await Doc.fromPath(PATH);
  try {
    expect(text(again.recoverable)).toBe('meanwhile');
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(listDrafts().filter((d) => d.path === null).map((d) => [d.name, text(loadDraft(d.key))])).toEqual([['Budget', 'recovered edits']]);
  } finally { again.destroy(); }
});

it('carries the edits made meanwhile along with the recovered draft when the file is renamed', async () => {
  await fileWithDraft();
  const doc = await openAndEdit();
  try {
    expect(await doc.rename('Plan')).toBeNull();
    const moved = draftKey('Spreadsheets/Plan.xlsx');
    expect(text(loadDraft(moved))).toBe('recovered edits');
    expect(text(loadDraft(liveDraftKey(moved)))).toBe('meanwhile');
    expect(loadDraft(KEY())).toBeNull();
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'meanwhile, later');
    expect(doc.writeDraft()).toBe(true);
    expect(text(loadDraft(liveDraftKey(moved)))).toBe('meanwhile, later');
  } finally { doc.destroy(); }
});
