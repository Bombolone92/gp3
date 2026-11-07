import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  expect(doc.path).toBe('Spreadsheets/Budget.xlsx');
  return doc;
}

const watchConflicts = (doc) => { const out = []; doc.addEventListener('conflict', (e) => out.push(e.detail)); return out; };
const edit = (doc, text) => doc.wb.setInput(doc.wb.activeSheetId, 0, 0, text);

// The drive stamps a rename as a modification, and the document kept the time from before it: the
// next autosave read the bumped time as a change made elsewhere, and "Reload theirs" threw the edits away.
it('saves after the file was renamed here without reporting a change made elsewhere', async () => {
  const doc = await openDocument();
  const conflicts = watchConflicts(doc);
  const before = mock.fs.get(doc.path).modified;
  await vi.advanceTimersByTimeAsync(2000); // the rename lands in a later second than the save
  try {
    expect(await doc.rename('Budget 2')).toBeNull();
    expect(mock.fs.get(doc.path).modified).toBeGreaterThan(before); // the mock stamps the rename as the server does
    edit(doc, 'edited after the rename');
    await vi.advanceTimersByTimeAsync(2000);
    expect(conflicts).toEqual([]);
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe('Spreadsheets/Budget 2.xlsx');
  } finally { doc.destroy(); }
});

it('saves after the file was renamed elsewhere, following it, without reporting a change', async () => {
  const doc = await openDocument();
  const conflicts = watchConflicts(doc);
  await vi.advanceTimersByTimeAsync(2000);
  await puter.fs.rename(doc.path, 'Renamed.xlsx');
  edit(doc, 'edited after the rename');
  await vi.advanceTimersByTimeAsync(2000);
  try {
    expect(conflicts).toEqual([]);
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe('Spreadsheets/Renamed.xlsx');
    expect(doc.name).toBe('Renamed');
  } finally { doc.destroy(); }
});

it('still reports a file rewritten elsewhere before it was renamed elsewhere', async () => {
  const doc = await openDocument();
  const conflicts = watchConflicts(doc);
  await vi.advanceTimersByTimeAsync(2000);
  await puter.fs.write(doc.path, new Blob(['rewritten by another tab']));
  await vi.advanceTimersByTimeAsync(2000);
  await puter.fs.rename(doc.path, 'Renamed.xlsx');
  edit(doc, 'mine');
  await vi.advanceTimersByTimeAsync(2000);
  try {
    expect(conflicts).toEqual([{ kind: 'changed', remoteModified: expect.any(Number) }]);
    expect(doc.status).toBe('conflict');
  } finally { doc.destroy(); }
});

it('still reports a file written elsewhere, to the same size, just before it was renamed here', async () => {
  const doc = await openDocument();
  const conflicts = watchConflicts(doc);
  await vi.advanceTimersByTimeAsync(2000);
  // Another tab's save of the same bytes count: the same size, other bytes (a file of the very same bytes is no change at all).
  const theirs = new Uint8Array(await mock.fs.get(doc.path).blob.arrayBuffer());
  theirs[theirs.length - 1] ^= 0xff;
  Object.assign(mock.fs.get(doc.path), { blob: new Blob([theirs]), modified: Date.now() / 1000 });
  await vi.advanceTimersByTimeAsync(2000);
  try {
    expect(await doc.rename('Budget 2')).toBeNull();
    edit(doc, 'mine');
    await vi.advanceTimersByTimeAsync(2000);
    expect(conflicts).toEqual([{ kind: 'changed', remoteModified: expect.any(Number) }]);
  } finally { doc.destroy(); }
});
