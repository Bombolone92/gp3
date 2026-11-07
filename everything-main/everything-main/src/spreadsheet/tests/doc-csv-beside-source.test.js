import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

// A .csv double-clicked on the desktop is edited as a spreadsheet and saved as an .xlsx: that file
// goes beside the .csv, where whoever opened it looks, not into the app's own data folder.
let mock;
beforeAll(async () => { await Doc.blank().toXlsxBlob(); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.puter; });

function csvAt(path) {
  const csv = new Blob(['a,b\n1,2\n'], { type: 'text/csv' });
  mock.fs.set(path, { blob: csv, size: csv.size, modified: 1 });
}

it('saves a .csv from elsewhere on the drive as an .xlsx beside it', async () => {
  csvAt('/nj/Desktop/data.csv');
  const doc = await Doc.fromPath('/nj/Desktop/data.csv');
  const moved = vi.fn();
  doc.addEventListener('path', (e) => moved(e.detail.path));
  try {
    doc.wb.setInput(doc.wb.activeSheetId, 2, 0, '3');
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('/nj/Desktop/data.xlsx');
    expect(doc.name).toBe('data');
    expect(moved).toHaveBeenCalledWith('/nj/Desktop/data.xlsx');
    expect(mock.fs.has('/nj/Desktop/data.csv')).toBe(true); // the source is left as it was
    expect([...mock.fs.keys()].some((k) => k.startsWith('Spreadsheets/') && !k.includes('/.versions/'))).toBe(false);
    // From then on the .xlsx is the file: saves overwrite it, they do not make another.
    doc.wb.setInput(doc.wb.activeSheetId, 3, 0, '4');
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('/nj/Desktop/data.xlsx');
    expect(mock.fs.has('/nj/Desktop/data (1).xlsx')).toBe(false);
  } finally { doc.destroy(); }
});

it('takes a free name beside it when an .xlsx of that name is there already', async () => {
  csvAt('~/Documents/data.csv');
  mock.fs.set('~/Documents/data.xlsx', { blob: new Blob(['theirs']), size: 6, modified: 1 });
  const doc = await Doc.fromPath('~/Documents/data.csv');
  try {
    doc.wb.setInput(doc.wb.activeSheetId, 2, 0, '3');
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('~/Documents/data (1).xlsx');
    expect(await mock.fs.get('~/Documents/data.xlsx').blob.text()).toBe('theirs');
  } finally { doc.destroy(); }
});

it('saves into the app folder when the source\'s folder will not take the file', async () => {
  csvAt('/alice/Shared/data.csv');
  const write = globalThis.puter.fs.write;
  globalThis.puter.fs.write = async (p, ...rest) => {
    if (p.startsWith('/alice/')) throw Object.assign(new Error('Permission denied'), { code: 'access_denied' });
    return write(p, ...rest);
  };
  const doc = await Doc.fromPath('/alice/Shared/data.csv');
  try {
    doc.wb.setInput(doc.wb.activeSheetId, 2, 0, '3');
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('Spreadsheets/data.xlsx');
  } finally { doc.destroy(); }
});

it('keeps a .csv in the app folder saving there', async () => {
  csvAt('Spreadsheets/data.csv');
  const doc = await Doc.fromPath('Spreadsheets/data.csv');
  try {
    doc.wb.setInput(doc.wb.activeSheetId, 2, 0, '3');
    expect(await doc.save()).toBe(true);
    expect(doc.path).toBe('Spreadsheets/data.xlsx');
  } finally { doc.destroy(); }
});
