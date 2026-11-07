import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft } from '../src/lib/drafts.js';
import { listVersions } from '../src/lib/versions.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const cellA1 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 0, 0);

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  expect(doc.path).toBe('Spreadsheets/Budget.xlsx');
  return doc;
}

// A file renamed or moved elsewhere while open was recreated at its old address by the next save,
// silently: two files then went their separate ways, the status pill saying "Saved".
it('follows a file renamed elsewhere while it is open and saves it there, records and all', async () => {
  const doc = await openDocument();
  const oldPath = doc.path;
  await doc.saveVersion('mark');
  doc.distrustExternal();
  await puter.fs.rename(oldPath, 'Plan.xlsx');
  const paths = [];
  const conflicts = [];
  doc.addEventListener('path', (e) => paths.push(e.detail));
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited after the move');
  expect(doc.writeDraft()).toBe(true);
  try {
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('Spreadsheets/Plan.xlsx');
    expect(doc.name).toBe('Plan');
    expect(doc.status).toBe('saved');
    expect(conflicts).toEqual([]);
    expect(paths).toEqual([{ path: 'Spreadsheets/Plan.xlsx', name: 'Plan', oldPath }]);
    expect(mock.fs.has(oldPath)).toBe(false);
    expect(loadDraft(draftKey(oldPath))).toBeNull();
    expect(loadDraft(draftKey(doc.path))).toBeNull();
    expect((await listVersions(doc.file)).map((v) => v.label)).toContain('mark');
    const reopened = await Doc.fromPath(doc.path);
    try {
      expect(cellA1(reopened)).toBe('edited after the move');
      expect(reopened.wb.externalAllowed).toBe(false);
    } finally { reopened.destroy(); }
  } finally { doc.destroy(); }
});

it('asks instead of recreating a file deleted elsewhere while it is open', async () => {
  const doc = await openDocument();
  const path = doc.path;
  mock.fs.delete(path);
  const conflicts = [];
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited after the delete');
  try {
    expect(await doc.save()).toBe(false);
    expect(conflicts).toEqual([{ kind: 'missing' }]);
    expect(doc.status).toBe('conflict');
    expect(doc.error).toBe('This file was moved or deleted');
    expect(mock.fs.has(path)).toBe(false);
    expect(doc.wb.dirty).toBe(true);
    expect(doc.writeDraft()).toBe(true);
    // No retry on its own either: the answer is the user's.
    await vi.advanceTimersByTimeAsync(20000);
    expect(mock.fs.has(path)).toBe(false);
    // Saving anyway puts the file back; saving under a name makes a new file. Either is a choice.
    expect(await doc.forceSave()).toBe(true);
    expect(mock.fs.has(path)).toBe(true);
    expect(doc.status).toBe('saved');
  } finally { doc.destroy(); }
});

it('names the kind of conflict when the file changed elsewhere', async () => {
  const doc = await openDocument();
  const conflicts = [];
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  await vi.advanceTimersByTimeAsync(2000);
  await puter.fs.write(doc.path, new Blob(['written by another tab']));
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'mine');
  try {
    expect(await doc.save()).toBe(false);
    expect(conflicts).toEqual([{ kind: 'changed', remoteModified: expect.any(Number) }]);
  } finally { doc.destroy(); }
});
