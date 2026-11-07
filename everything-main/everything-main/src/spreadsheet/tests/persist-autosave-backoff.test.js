import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Budget');
  expect(await doc.save()).toBe(true);
  return doc;
}

// An autosave that kept failing (a full drive, say) was tried again every 8 seconds for as long as
// the tab stayed open, the whole book encoded and sent each time.
it('spaces out the retries of an autosave that keeps failing, and starts over at the next edit', async () => {
  const doc = await openDocument();
  const write = puter.fs.write;
  let failing = true;
  const attempts = [];
  puter.fs.write = async (path, ...rest) => {
    if (!failing || path !== doc.path) return write.call(puter.fs, path, ...rest); // the history's snapshots are not the file
    attempts.push(Date.now());
    throw new Error('Storage quota exceeded');
  };
  const start = Date.now();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit');
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(['error', 'offline']).toContain(doc.status);
    expect(doc.error).toBe('Storage quota exceeded');
    // The autosave, then retries after 8, 16 and 32 seconds: growing pauses, not one every 8 seconds.
    expect(attempts.map((at) => Math.round((at - start) / 1000))).toEqual([2, 10, 26, 58].map((s) => expect.closeTo(s, -1)));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(attempts.length).toBeLessThan(15);
    // Still tried now and then, so a drive with room again gets the edits without anyone's help.
    const before = attempts.length;
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(attempts.length).toBeGreaterThan(before);
    // An edit starts the schedule over: the autosave comes soon, and the first retry 8 seconds after it.
    const n = attempts.length;
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit 2');
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toHaveLength(n + 1);
    await vi.advanceTimersByTimeAsync(9000);
    expect(attempts).toHaveLength(n + 2);
    // Once a write goes through, the edits land and the schedule is forgotten.
    failing = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(doc.status).toBe('saved');
    expect(doc.wb.dirty).toBe(false);
  } finally { doc.destroy(); }
});
