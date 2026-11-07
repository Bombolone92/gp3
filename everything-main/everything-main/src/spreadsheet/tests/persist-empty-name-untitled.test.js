import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc, UNTITLED } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
// SheetJS is loaded on first use with a real dynamic import; warm it up so no test waits on it.
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

// A name that sanitizes to nothing ("..", a lone space) was saved as the dotfile Spreadsheets/.xlsx,
// and the document, the tab title and the home screen's row were left nameless.
it('saves a document whose name sanitizes to nothing under the untitled name', async () => {
  const doc = new Doc({ name: '..' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  try {
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe(`Spreadsheets/${UNTITLED}.xlsx`);
    expect(doc.name).toBe(UNTITLED);
    expect([...mock.fs.keys()].filter((p) => /\/\.xlsx$/.test(p))).toEqual([]);
  } finally { doc.destroy(); }
});

it('saves a file from elsewhere whose stem sanitizes to nothing as a new untitled spreadsheet', async () => {
  const doc = new Doc({ name: '..', path: '/nj/Desktop/...csv' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  try {
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe(`/nj/Desktop/${UNTITLED}.xlsx`);
    expect(doc.name).toBe(UNTITLED);
  } finally { doc.destroy(); }
});

it('names an import from the device whose stem sanitizes to nothing untitled', async () => {
  const doc = await Doc.fromBrowserFile(new File(['a,b\n1,2'], '...csv'));
  try {
    expect(doc.name).toBe(UNTITLED);
    expect(doc.wb.getValue(doc.wb.activeSheetId, 1, 1)).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(doc.status).toBe('saved');
    expect(doc.path).toBe(`Spreadsheets/${UNTITLED}.xlsx`);
  } finally { doc.destroy(); }
});

it('keeps an ordinary import\'s name', async () => {
  const doc = await Doc.fromBrowserFile(new File(['a,b\n1,2'], 'Q3 sales.csv'));
  try {
    expect(doc.name).toBe('Q3 sales');
  } finally { doc.destroy(); }
});
