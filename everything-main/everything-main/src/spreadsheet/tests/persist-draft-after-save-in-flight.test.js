import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft } from '../src/lib/drafts.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const text = (draft) => draft?.workbook.sheets[0].cells['0,0']?.v;

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  return doc;
}

// A draft written while a save was in flight recorded the file's time from before that save, and the
// corrective rewrite came 600 ms after the save landed: a tab closed in between left a draft that, on
// reopening, was offered as older than the file, with a warning that restoring it would undo the save,
// although its edits postdated the file.
it('rewrites the draft as soon as a save lands while the book is still dirty, so the edits are not taken for older than the file', async () => {
  const doc = await openDocument();
  const key = draftKey(doc.path);
  const write = puter.fs.write;
  let release;
  puter.fs.write = async (path, ...rest) => {
    if (path === doc.path) await new Promise((resolve) => { release = resolve; }); // a slow write
    return write.call(puter.fs, path, ...rest);
  };
  const before = doc.remoteModified;
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'one');
  await vi.advanceTimersByTimeAsync(1600); // the autosave is in flight
  expect(doc.status).toBe('saving');
  expect(release).toBeTypeOf('function');
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'two');
  await vi.advanceTimersByTimeAsync(700); // its draft is written against the file as it was before the save
  expect(text(loadDraft(key))).toBe('two');
  expect(loadDraft(key).fileModified).toBe(before);
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(doc.remoteModified).not.toBe(before);
  expect(doc.wb.dirty).toBe(true);
  // The draft already speaks of the file as it is now.
  expect(loadDraft(key).fileModified).toBe(doc.remoteModified);
  expect(text(loadDraft(key))).toBe('two');
  // Reopened now, the edits are offered as the newest, not as older than the file.
  puter.fs.write = write;
  doc.destroy();
  const again = await Doc.fromPath(doc.path);
  try {
    expect(again.wb.getValue(again.wb.activeSheetId, 0, 0)).toBe('one');
    expect(text(again.recoverable)).toBe('two');
    expect(again.recoverableMayBeOlder).toBe(false);
  } finally { again.destroy(); }
});
