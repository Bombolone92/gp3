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
  return doc;
}

/** Writes to the document's file fail (a full drive, an outage) while `failing` is set; the attempts are counted. */
function failWrites(doc) {
  const write = puter.fs.write;
  const state = { failing: true, attempts: 0 };
  puter.fs.write = async (path, ...rest) => {
    if (!state.failing || path !== doc.path) return write.call(puter.fs, path, ...rest); // the history's snapshots are not the file
    state.attempts++;
    throw new Error('Storage quota exceeded');
  };
  return state;
}

// A save asked for by hand (Ctrl+S, the flush on the way out, "Overwrite with mine", "Keep it here")
// cleared the retry a failed autosave had scheduled, and armed none of its own when it failed too:
// nothing tried again until the next edit, so an outage that ended left the edit unsaved for good.
it('keeps trying after a save asked for by hand fails, as after a failed autosave', async () => {
  const doc = await openDocument();
  const writes = failWrites(doc);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit');
  try {
    await vi.advanceTimersByTimeAsync(3000); // the autosave failed; its retry is due in 8 seconds
    expect(writes.attempts).toBe(1);
    await expect(doc.save()).rejects.toThrow('Storage quota exceeded');
    expect(writes.attempts).toBe(2);
    expect(['error', 'offline']).toContain(doc.status);
    await vi.advanceTimersByTimeAsync(9000);
    expect(writes.attempts).toBe(3); // tried again 8 seconds after the failed save
    writes.failing = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(doc.status).toBe('saved');
    expect(doc.wb.dirty).toBe(false);
    expect(mock.fs.get(doc.path).blob.size).toBeGreaterThan(0);
  } finally { doc.destroy(); }
});

it('asks again later when a save forced over a missing file fails, instead of falling silent', async () => {
  const doc = await openDocument();
  const path = doc.path;
  const conflicts = [];
  doc.addEventListener('conflict', (e) => conflicts.push(e.detail));
  mock.fs.delete(path);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited after the delete');
  const writes = failWrites(doc);
  try {
    expect(await doc.save()).toBe(false);
    expect(conflicts).toEqual([{ kind: 'missing' }]);
    await expect(doc.forceSave()).rejects.toThrow('Storage quota exceeded');
    expect(writes.attempts).toBe(1);
    // The file is still gone when the retry comes: the question is put again rather than nothing at all.
    await vi.advanceTimersByTimeAsync(9000);
    expect(conflicts).toEqual([{ kind: 'missing' }, { kind: 'missing' }]);
    expect(writes.attempts).toBe(1);
    expect(doc.wb.dirty).toBe(true);
  } finally { doc.destroy(); }
});

it('does not try again when the failed save had nothing pending, or without a session', async () => {
  // A clean book saved by hand for the first time: nothing is pending once that fails.
  const doc = Doc.blank();
  const write = puter.fs.write;
  let attempts = 0;
  puter.fs.write = async () => { attempts++; throw new Error('Storage quota exceeded'); };
  try {
    await expect(doc.save()).rejects.toThrow('Storage quota exceeded');
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempts).toBe(1);
  } finally { puter.fs.write = write; doc.destroy(); }
});
