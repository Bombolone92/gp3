import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const PATH = 'Spreadsheets/Budget.xlsx';

/** A file on the drive, opened here without any save in the session yet. */
async function openFile() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  const bytes = await doc.toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  const opened = await Doc.fromPath(PATH);
  const conflicts = [];
  opened.addEventListener('conflict', (e) => conflicts.push(e.detail));
  return { doc: opened, conflicts };
}

// The read-back that tells a rename away and back (or a trash restore) elsewhere from a change made there
// compared the file with the bytes last written in the session, so before the first save it had nothing
// to compare with: the first save after such a rename raised the conflict dialog, whose "Reload theirs"
// discards the edits, for a file whose bytes were the very ones just opened.
it('saves after the file was renamed away and back elsewhere before any save in the session, instead of reporting a change made elsewhere', async () => {
  const { doc, conflicts } = await openFile();
  await vi.advanceTimersByTimeAsync(5000);
  await puter.fs.rename(PATH, 'Other.xlsx');
  await puter.fs.rename('Spreadsheets/Other.xlsx', 'Budget.xlsx');
  expect(mock.fs.get(PATH).modified * 1000).toBeGreaterThan(doc.remoteModified);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited after the rename');
  try {
    expect(await doc.save()).toBe(true);
    expect(doc.status).toBe('saved');
    expect(conflicts).toEqual([]);
    const reopened = await Doc.fromPath(PATH);
    try { expect(reopened.wb.getValue(reopened.wb.activeSheetId, 0, 0)).toBe('edited after the rename'); } finally { reopened.destroy(); }
  } finally { doc.destroy(); }
});

it('still reports a file of the same size written elsewhere with other bytes before any save in the session', async () => {
  const { doc, conflicts } = await openFile();
  await vi.advanceTimersByTimeAsync(5000);
  const bytes = new Uint8Array(await mock.fs.get(PATH).blob.arrayBuffer());
  bytes[bytes.length - 1] ^= 0xff; // the same size, another book
  const theirs = new Blob([bytes]);
  mock.fs.set(PATH, { blob: theirs, size: theirs.size, modified: Date.now() / 1000, uid: mock.fs.get(PATH).uid });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'mine');
  try {
    expect(await doc.save()).toBe(false);
    expect(conflicts).toEqual([{ kind: 'changed', remoteModified: expect.any(Number) }]);
    expect(doc.status).toBe('conflict');
    expect(mock.fs.get(PATH).blob).toBe(theirs);
  } finally { doc.destroy(); }
});

it('saves over a file whose look-up failed at open once the read-back shows its bytes unchanged', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  const bytes = await doc.toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  const stat = puter.fs.stat.bind(puter.fs);
  let fail = true;
  puter.fs.stat = async (p) => { if (fail) { fail = false; throw new Error('Network request failed'); } return stat(p); };
  const opened = await Doc.fromPath(PATH);
  expect(opened.remoteModified).toBe(0);
  const conflicts = [];
  opened.addEventListener('conflict', (e) => conflicts.push(e.detail));
  opened.wb.setInput(opened.wb.activeSheetId, 0, 0, 'edit');
  try {
    expect(await opened.save()).toBe(true);
    expect(conflicts).toEqual([]);
    expect(opened.status).toBe('saved');
  } finally { opened.destroy(); }
});
