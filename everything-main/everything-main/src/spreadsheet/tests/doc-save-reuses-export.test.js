import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// Encoding the whole book to .xlsx runs on the main thread for every save. A save tried again for the
// same version of the book (a retry after a failed write, a save forced after a conflict) sends the
// bytes already built instead of building them again; a new version is built anew.
let mock;
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

it('sends the bytes already built when a save of the same version is tried again, and builds a new version anew', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'hello');
  const exports = vi.spyOn(doc.wb, 'spillEntries'); // asked once per sheet by every export
  const write = puter.fs.write;
  let failing = true;
  puter.fs.write = async (path, ...rest) => {
    if (failing && !path.includes('/.versions/')) throw new Error('Storage quota exceeded');
    return write.call(puter.fs, path, ...rest);
  };
  try {
    await expect(doc.save()).rejects.toThrow('Storage quota exceeded');
    const built = exports.mock.calls.length;
    expect(built).toBeGreaterThan(0);
    const blob = doc._exported.blob;
    failing = false;
    expect(await doc.save()).toBe(true);
    expect(exports.mock.calls.length).toBe(built);
    expect(doc.status).toBe('saved');
    expect(mock.fs.get(doc.path).blob).toBe(blob);
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edited');
    expect(await doc.save()).toBe(true);
    expect(exports.mock.calls.length).toBeGreaterThan(built);
    expect(mock.fs.get(doc.path).blob).not.toBe(blob);
  } finally { doc.destroy(); }
});
