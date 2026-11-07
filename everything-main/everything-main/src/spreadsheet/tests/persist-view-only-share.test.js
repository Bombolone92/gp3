import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc, VIEW_ONLY } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// A spreadsheet shared with the user only to view took every edit as an autosave Puter refused, said
// "Forbidden", and sent the whole book again at growing intervals for as long as the tab stayed open.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  installMockPuter();
  vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: true });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete globalThis.puter; });

async function openDocument() {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'saved');
  await doc.rename('Shared');
  expect(await doc.save()).toBe(true);
  return doc;
}

it('says why a view-only spreadsheet is not saved, and does not keep trying', async () => {
  const doc = await openDocument();
  doc.viewOnly = true;
  const write = puter.fs.write;
  const attempts = [];
  puter.fs.write = async (path, ...rest) => {
    if (path !== doc.path) return write.call(puter.fs, path, ...rest);
    attempts.push(Date.now());
    throw Object.assign(new Error('Forbidden'), { code: 'access_denied' });
  };
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit');
  try {
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(doc.status).toBe('error');
    expect(doc.error).toBe(VIEW_ONLY);
    expect(attempts).toHaveLength(1);
    // The edits stay, unsaved, and a later edit tries once more (the owner may have let the user edit since).
    expect(doc.wb.dirty).toBe(true);
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit 2');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toHaveLength(2);
  } finally { doc.destroy(); }
});

it('keeps trying a spreadsheet the user may edit', async () => {
  const doc = await openDocument();
  const write = puter.fs.write;
  const attempts = [];
  puter.fs.write = async (path, ...rest) => {
    if (path !== doc.path) return write.call(puter.fs, path, ...rest);
    attempts.push(Date.now());
    throw new Error('Storage quota exceeded');
  };
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'edit');
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(doc.error).toBe('Storage quota exceeded');
    expect(attempts.length).toBeGreaterThan(1);
  } finally { doc.destroy(); }
});

it('saves a copy of a view-only spreadsheet as the user’s own, which saves as usual', async () => {
  const doc = await openDocument();
  doc.viewOnly = true;
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'mine');
  try {
    expect(await doc.saveAs('My copy')).toBeFalsy();
    expect(doc.viewOnly).toBe(false);
    expect(doc.path).toMatch(/My copy\.xlsx$/);
  } finally { doc.destroy(); }
});
