import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, liveDraftKey, saveDraft, loadDraft, listDrafts, draftKeyForFile } from '../src/lib/drafts.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const PATH = 'Spreadsheets/Budget.xlsx';
const MOVED = 'Spreadsheets/Q3.xlsx';
const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;
/** Every draft record in this browser, by its address (the account prefix aside) and first cell. */
const records = () => localStorage.keys().filter((k) => k.includes(':draft')).map((k) => [k.replace(/^.*?(Spreadsheets\/|new:)/, '$1').replace(/:[0-9a-f]{32}$/, ''), text(loadDraft(k))]).sort();
const unsaved = () => listDrafts().filter((d) => d.path === null).map((d) => [d.name, text(loadDraft(d.key))]).sort();

function book(value) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, value);
  return wb;
}

/**
 * A file with a draft of edits that never reached Puter, offered once and left undecided, then
 * edited past and closed: the earlier draft waits under the file's key, the later edits beside it.
 * `withUid` says whether the earlier draft names the file (a legacy draft does not).
 */
async function closedUndecided({ withUid = true } = {}) {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  const uid = (await puter.fs.stat(PATH)).uid;
  expect(saveDraft(draftKey(PATH), book('recovered edits'), 'Budget', 'rev-old', withUid ? { fileModified: 1000, fileUid: uid } : {})).toBe(true);
  const doc = await Doc.fromPath(PATH);
  expect(text(doc.recoverable)).toBe('recovered edits');
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'meanwhile');
  expect(doc.writeDraft()).toBe(true);
  doc.destroy();
  expect(records()).toEqual([['Spreadsheets/Budget.xlsx', 'recovered edits'], ['Spreadsheets/Budget.xlsx:live', 'meanwhile']]);
  return uid;
}

// Opened at the address a rename elsewhere gave it, the file found its draft by id and took only that
// one along: the edits made beside it while it awaited a decision, the newest and never saved, stayed
// under the old address, offered nowhere and listed nowhere, while the older draft was offered as the
// latest. Now both follow, and the later edits are offered, as they are when the file is reopened where it was.
it('offers the edits made beside an undecided draft when the file is opened under the name a rename elsewhere gave it, and keeps the draft as an unsaved spreadsheet', async () => {
  await closedUndecided();
  await puter.fs.rename(PATH, 'Q3.xlsx');
  const doc = await Doc.fromPath(MOVED);
  try {
    expect(text(doc.recoverable)).toBe('meanwhile');
    expect(text(loadDraft(draftKey(MOVED)))).toBe('meanwhile');
    expect(loadDraft(draftKey(PATH))).toBeNull();
    expect(loadDraft(liveDraftKey(draftKey(PATH)))).toBeNull();
    expect(loadDraft(liveDraftKey(draftKey(MOVED)))).toBeNull();
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
    // Restoring the offer and saving leaves nothing behind under either address.
    expect(doc.restoreDraft()).toBe(true);
    expect(await doc.save()).toBe(true);
    expect(records()).toEqual([['new:Budget', 'recovered edits']]);
  } finally { doc.destroy(); }
});

it('follows the file by the edits kept beside a draft that does not name it, and offers those edits', async () => {
  const uid = await closedUndecided({ withUid: false });
  expect(draftKeyForFile(uid)).toBe(draftKey(PATH)); // found through the edits beside it
  await puter.fs.rename(PATH, 'Q3.xlsx');
  const doc = await Doc.fromPath(MOVED);
  try {
    expect(text(doc.recoverable)).toBe('meanwhile');
    expect(loadDraft(draftKey(PATH))).toBeNull();
    expect(loadDraft(liveDraftKey(draftKey(PATH)))).toBeNull();
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
  } finally { doc.destroy(); }
});

it('takes the edits kept beside a draft along when the file is opened by another spelling of its address', async () => {
  const bytes = await Doc.blank().toXlsxBlob();
  const absolute = '/nj/AppData/app/Spreadsheets/Budget.xlsx';
  mock.fs.set(absolute, { blob: bytes, size: bytes.size, modified: 1 });
  mock.fs.set('/nj/AppData/app/Spreadsheets/.keep', { blob: new Blob(['']), size: 0, modified: 1 });
  expect(saveDraft(draftKey(PATH), book('recovered edits'), 'Budget', 'rev-old')).toBe(true);
  expect(saveDraft(liveDraftKey(draftKey(PATH)), book('meanwhile'), 'Budget', 'rev-live')).toBe(true);
  // The drive answers for the relative address with the absolute one it keeps.
  const stat = puter.fs.stat.bind(puter.fs);
  puter.fs.stat = async (p) => stat(p === PATH ? absolute : p === 'Spreadsheets' ? '/nj/AppData/app/Spreadsheets' : p);
  const read = puter.fs.read.bind(puter.fs);
  puter.fs.read = async (p) => read(p === PATH ? absolute : p);
  const doc = await Doc.fromPath(PATH);
  try {
    expect(doc.path).toBe(absolute);
    expect(text(doc.recoverable)).toBe('meanwhile');
    expect(loadDraft(draftKey(PATH))).toBeNull();
    expect(loadDraft(liveDraftKey(draftKey(PATH)))).toBeNull();
    expect(text(loadDraft(draftKey(absolute)))).toBe('meanwhile');
    expect(unsaved()).toEqual([['Budget', 'recovered edits']]);
  } finally { doc.destroy(); }
});
