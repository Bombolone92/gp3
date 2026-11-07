import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { memoryStorage } from './helpers/memory-storage.js';

Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

// Whether a file may load outside content (IMPORT* formulas, web images) is
// decided once per file. That decision must survive the file's first save
// into the app folder, which used to be trusted wholesale, and must not
// linger on a path the file has left.
describe('remembering the outside-content decision', () => {
  let mock;
  beforeEach(() => { mock = installMockPuter(); localStorage.clear(); });
  afterEach(() => { delete globalThis.puter; });

  const place = async (path) => {
    const bytes = await Doc.blank().toXlsxBlob();
    mock.fs.set(path, { blob: bytes, size: bytes.size, modified: 1 });
    return bytes;
  };

  it('keeps an import from the device blocked after its first save lands in the app folder', async () => {
    const bytes = await place('unused.xlsx');
    const imported = await Doc.fromBrowserFile(new File([await bytes.arrayBuffer()], 'device.xlsx'));
    expect(imported.wb.externalAllowed).toBe(false);
    expect(await imported.save()).toBe(true);
    expect(imported.path).toBe('Spreadsheets/device.xlsx');
    expect((await Doc.fromPath(imported.path)).wb.externalAllowed).toBe(false);
    imported.allowExternal();
    expect((await Doc.fromPath(imported.path)).wb.externalAllowed).toBe(true);
  });

  it('keeps a copy saved under a new name blocked too', async () => {
    const bytes = await place('unused.xlsx');
    const imported = await Doc.fromBrowserFile(new File([await bytes.arrayBuffer()], 'device.xlsx'));
    expect(await imported.saveAs('Copy of device')).toBeNull();
    expect((await Doc.fromPath('Spreadsheets/Copy of device.xlsx')).wb.externalAllowed).toBe(false);
  });

  it('keeps a CSV from elsewhere blocked once it is saved as .xlsx in the folder', async () => {
    const csv = new Blob(['a,b\n1,2\n']);
    mock.fs.set('Desktop/data.csv', { blob: csv, size: csv.size, modified: 1 });
    const opened = await Doc.fromPath('Desktop/data.csv');
    expect(opened.wb.externalAllowed).toBe(false);
    opened.wb.setInput(opened.wb.activeSheetId, 2, 0, 'x');
    expect(await opened.save()).toBe(true);
    expect(opened.path).toBe('Spreadsheets/data.xlsx');
    expect((await Doc.fromPath(opened.path)).wb.externalAllowed).toBe(false);
  });

  it('forgets the old path when a file from elsewhere is renamed', async () => {
    await place('Desktop/shared.xlsx');
    const opened = await Doc.fromPath('Desktop/shared.xlsx');
    opened.allowExternal();
    expect(await opened.rename('renamed')).toBeNull();
    expect((await Doc.fromPath('Desktop/renamed.xlsx')).wb.externalAllowed).toBe(true);
    await place('Desktop/shared.xlsx'); // somebody else's file takes the old name
    expect((await Doc.fromPath('Desktop/shared.xlsx')).wb.externalAllowed).toBe(false);
  });

  it('still trusts files made here and files already in the folder', async () => {
    const doc = Doc.blank();
    doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
    await doc.save();
    expect((await Doc.fromPath(doc.path)).wb.externalAllowed).toBe(true);
    await place('Spreadsheets/Mine.xlsx');
    expect((await Doc.fromPath('Spreadsheets/Mine.xlsx')).wb.externalAllowed).toBe(true);
  });
});
