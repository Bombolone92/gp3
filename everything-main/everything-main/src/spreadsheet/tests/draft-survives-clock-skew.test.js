import { afterEach, beforeEach, expect, it } from 'vitest';
import { draftKey, saveDraft, loadDraft } from '../src/lib/drafts.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

const path = 'Spreadsheets/Budget.xlsx';
const text = (draft) => draft?.workbook.sheets[0].cells['0,0'].v;

/** The file, last written at `modified` (seconds) by a server whose clock need not agree with this one. */
async function place(modified) {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(path, { blob: bytes, size: bytes.size, modified });
}

/** Open the file, type, and close the tab before anything is saved. */
async function typeAndClose(value) {
  const doc = await Doc.fromPath(path);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, value);
  expect(doc.writeDraft()).toBe(true);
  doc.destroy();
}

// A draft was offered only when this browser's clock said it was written after the
// file's server-side modification time, and was deleted otherwise. Edits made within
// clock-skew seconds of the last save, never saved, were destroyed silently on reopen.
it('offers a draft of edits made on the file\'s current revision even when its clock reads earlier than the file\'s', async () => {
  await place(Math.floor(Date.now() / 1000) + 30); // the server's clock runs half a minute ahead
  await typeAndClose('typed right after the save');
  const reopened = await Doc.fromPath(path);
  expect(text(reopened.recoverable)).toBe('typed right after the save');
  expect(reopened.recoverableMayBeOlder).toBe(false);
  reopened.destroy();
});

it('still offers a draft when the file was written since, saying it may be older than the file', async () => {
  await place(1000);
  await typeAndClose('edits from another day');
  mock.fs.get(path).modified = 2000; // another device saved meanwhile
  const reopened = await Doc.fromPath(path);
  expect(text(reopened.recoverable)).toBe('edits from another day');
  expect(reopened.recoverableMayBeOlder).toBe(true);
  reopened.destroy();
});

it('offers a draft when the file cannot be checked, and drops it once it is saved', async () => {
  await place(1000);
  await typeAndClose('unsaved');
  const stat = puter.fs.stat;
  puter.fs.stat = async () => { throw new Error('Network request failed'); };
  const reopened = await Doc.fromPath(path);
  expect(text(reopened.recoverable)).toBe('unsaved');
  puter.fs.stat = stat;
  expect(reopened.restoreDraft()).toBe(true);
  expect(await reopened.forceSave()).toBe(true);
  expect(loadDraft(draftKey(path))).toBeNull();
  reopened.destroy();
});

// Drafts written before the file's revision was recorded with them can only be judged by their
// own clock: one from around the time of the last save is kept, one from long before is stale.
it('keeps a draft without a recorded revision unless it is clearly older than the file', async () => {
  const now = Math.floor(Date.now() / 1000);
  await place(now);
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'legacy');
  const write = (savedAt) => {
    expect(saveDraft(draftKey(path), wb, 'Budget')).toBe(true);
    const raw = JSON.parse(localStorage.getItem(draftKey(path)));
    expect(raw.fileModified).toBeUndefined();
    raw.savedAt = savedAt;
    localStorage.setItem(draftKey(path), JSON.stringify(raw));
  };
  write(now * 1000 - 20_000);
  const nearby = await Doc.fromPath(path);
  expect(text(nearby.recoverable)).toBe('legacy');
  expect(nearby.recoverableMayBeOlder).toBe(true);
  nearby.destroy();
  write(now * 1000 - 3 * 60_000);
  const ancient = await Doc.fromPath(path);
  expect(ancient.recoverable).toBeNull();
  expect(loadDraft(draftKey(path))).toBeNull();
  ancient.destroy();
});
