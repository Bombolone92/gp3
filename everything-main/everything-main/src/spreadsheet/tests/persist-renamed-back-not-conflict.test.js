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

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  expect(doc.path).toBe(PATH);
  const conflicts = [];
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  return { doc, conflicts };
}

// The drive stamps a rename as a modification. A file renamed away and back (or put back from the
// trash) elsewhere while open kept its size and its bytes, but its newer time read as a change made
// elsewhere: the next save raised the conflict dialog, whose "Reload theirs" discards the edits.
it('saves after the file was renamed away and back elsewhere, its bytes unchanged, instead of reporting a change made elsewhere', async () => {
  const { doc, conflicts } = await openDocument();
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

it('still reports a file of the same size written elsewhere with other bytes', async () => {
  const { doc, conflicts } = await openDocument();
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
    expect(doc.error).toBe('This file changed elsewhere');
    expect(mock.fs.get(PATH).blob).toBe(theirs);
  } finally { doc.destroy(); }
});
