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
/** The drafts of spreadsheets without a file, as the home screen lists them: [name, first cell]. */
const unsaved = () => listDrafts().filter((d) => d.path === null).map((d) => [d.name, text(loadDraft(d.key))]).sort();

function book(value) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  return wb;
}

/**
 * A blank file on the drive whose draft of edits that never reached Puter was offered once, dismissed
 * without a decision and edited past, the tab then closing: the closed tab leaves both behind.
 */
async function closedUndecided() {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  expect(saveDraft(KEY(), book('recovered edits'), 'Budget', 'rev-old')).toBe(true);
  const doc = await Doc.fromPath(PATH);
  expect(text(doc.recoverable)).toBe('recovered edits');
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'meanwhile');
  expect(doc.writeDraft()).toBe(true);
  doc.destroy();
  expect(text(loadDraft(KEY()))).toBe('recovered edits');
  expect(text(loadDraft(liveDraftKey(KEY())))).toBe('meanwhile');
}

// The edits made while an earlier draft awaited a decision were kept beside it, under a key the
// home screen never listed. Opened again with both still there, the file offered the earlier draft
// once more, and the first keystroke wrote this session's draft over those edits; discarding the
// offer before any edit left them stranded under that key for good.
it('offers the edits made beside an undecided draft on a later open, keeping that draft as an unsaved spreadsheet, and never writes over them', async () => {
  await closedUndecided();
  const doc = await Doc.fromPath(PATH);
  try {
    expect(text(doc.recoverable)).toBe('meanwhile');
    expect(doc.recoverableMayBeOlder).toBe(false);
    expect(text(loadDraft(KEY()))).toBe('meanwhile');
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
    // This session's edits are drafted beside the offer, as ever, and the earlier draft stays listed.
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'session two');
    expect(doc.writeDraft()).toBe(true);
    expect(text(loadDraft(KEY()))).toBe('meanwhile');
    expect(text(loadDraft(liveDraftKey(KEY())))).toBe('session two');
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
    doc.discardDraft();
    expect(text(loadDraft(KEY()))).toBe('session two');
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(await doc.save()).toBe(true);
    expect(loadDraft(KEY())).toBeNull();
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
  } finally { doc.destroy(); }
});

it('moves or clears the edits kept beside the draft whichever document wrote them, when the offer is decided before any edit here', async () => {
  const doc = new Doc({ name: 'Budget', path: PATH });
  expect(saveDraft(KEY(), book('recovered edits'), 'Budget', 'rev-old')).toBe(true);
  expect(saveDraft(liveDraftKey(KEY()), book('meanwhile'), 'Budget', 'rev-live')).toBe(true);
  doc.recoverable = loadDraft(KEY());
  doc.discardDraft();
  expect(text(loadDraft(KEY()))).toBe('meanwhile');
  expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
  doc.destroy();
  const other = new Doc({ name: 'Budget', path: PATH });
  expect(saveDraft(KEY(), book('recovered edits'), 'Budget', 'rev-old')).toBe(true);
  expect(saveDraft(liveDraftKey(KEY()), book('meanwhile'), 'Budget', 'rev-live')).toBe(true);
  other.recoverable = loadDraft(KEY());
  expect(other.restoreDraft()).toBe(true);
  expect(cellA1(other)).toBe('recovered edits');
  expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
  other.destroy();
});

it('opens the edits made beside an undecided draft of a file since deleted as the new spreadsheet, and keeps the draft too', async () => {
  await closedUndecided();
  mock.fs.delete(PATH);
  const doc = await Doc.fromPath(PATH);
  try {
    expect(doc.path).toBeNull();
    expect(cellA1(doc)).toBe('meanwhile');
    expect(loadDraft(KEY())).toBeNull();
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(unsaved()).toEqual([['Budget', 'meanwhile'], ['Budget', 'recovered edits']]);
  } finally { doc.destroy(); }
});

it('carries both along when the file was renamed elsewhere, and offers the edits made beside the draft there', async () => {
  await closedUndecided();
  await puter.fs.rename(PATH, 'Plan.xlsx');
  const doc = await Doc.fromPath(PATH);
  try {
    expect(doc.path).toBe('Spreadsheets/Plan.xlsx');
    expect(text(doc.recoverable)).toBe('meanwhile');
    expect(loadDraft(KEY())).toBeNull();
    expect(loadDraft(liveDraftKey(KEY()))).toBeNull();
    expect(text(loadDraft(draftKey('Spreadsheets/Plan.xlsx')))).toBe('meanwhile');
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
  } finally { doc.destroy(); }
});
