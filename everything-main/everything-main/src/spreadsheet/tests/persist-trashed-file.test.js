import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { draftKey, loadDraft, listDrafts } from '../src/lib/drafts.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const A1 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 0, 0);

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  expect(doc.path).toBe('Spreadsheets/Budget.xlsx');
  return doc;
}

/** Delete a file the way the Puter desktop does: moved into ~/Trash under its bare id, its name kept in metadata. */
function trash(path) {
  const f = mock.fs.get(path);
  mock.fs.delete(path);
  mock.fs.set(`/nj/Trash/${f.uid}`, f);
  return `/nj/Trash/${f.uid}`;
}

// A file deleted on the desktop while open was found again by its id in the trash and followed there:
// the next save, seeing no .xlsx extension, made a new file named after the id, and the document, its
// title and its history folder took that name, with the trash address listed under recently opened.
it('asks what to do with the edits when the open file is put in the trash elsewhere, rather than following it there', async () => {
  const doc = await openDocument();
  const path = doc.path;
  const trashed = trash(path);
  const conflicts = [];
  const paths = [];
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  doc.addEventListener('path', (e) => paths.push(e.detail));
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited after the delete');
  await vi.advanceTimersByTimeAsync(2000);
  try {
    expect(conflicts).toEqual([{ kind: 'missing' }]);
    expect(paths).toEqual([]);
    expect(doc.status).toBe('conflict');
    expect(doc.path).toBe(path);
    expect(doc.name).toBe('Budget');
    expect([...mock.fs.keys()].filter((k) => !k.includes('/.versions/'))).toEqual([trashed]);
    // Saving anyway puts the file back where it was, as for any file deleted elsewhere.
    expect(await doc.forceSave()).toBe(true);
    expect(doc.path).toBe(path);
    expect(mock.fs.has(path)).toBe(true);
  } finally { doc.destroy(); }
});

it('asks as well when the file was renamed elsewhere to a name without the .xlsx extension', async () => {
  const doc = await openDocument();
  const path = doc.path;
  await puter.fs.rename(path, 'Budget');
  const conflicts = [];
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited after the rename');
  await vi.advanceTimersByTimeAsync(2000);
  try {
    expect(conflicts).toEqual([{ kind: 'missing' }]);
    expect(doc.path).toBe(path);
  } finally { doc.destroy(); }
});

it('opens the draft of a file since put in the trash as a new spreadsheet, not from the trash', async () => {
  const original = await openDocument();
  const path = original.path;
  original.wb.setInput(original.wb.activeSheetId, 0, 0, 'never saved');
  expect(original.writeDraft()).toBe(true);
  original.destroy();
  trash(path);
  const doc = await Doc.fromPath(path);
  try {
    expect(doc.path).toBeNull();
    expect(doc.name).toBe('Budget');
    expect(A1(doc)).toBe('never saved');
    expect(loadDraft(draftKey(path))).toBeNull();
    expect(listDrafts().map((d) => d.path)).toEqual([null]);
  } finally { doc.destroy(); }
});
