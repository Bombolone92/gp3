import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

/** The zip's entries in file order, from the local headers: name, method, sizes. */
function entries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let off = 0; off + 30 <= bytes.length && view.getUint32(off, true) === 0x04034b50;) {
    const method = view.getUint16(off + 8, true);
    const compressed = view.getUint32(off + 18, true);
    const size = view.getUint32(off + 22, true);
    const nameLength = view.getUint16(off + 26, true);
    const extraLength = view.getUint16(off + 28, true);
    out.push({ name: new TextDecoder().decode(bytes.subarray(off + 30, off + 30 + nameLength)), method, compressed, size, extraLength, offset: off });
    off += 30 + nameLength + extraLength + compressed;
  }
  return out;
}
function book(rows, cols) {
  const wb = new Workbook({ sheets: [{ name: 'Data', rows: rows + 20, cols: cols + 6 }] });
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c, cell: { v: r * 1000 + c + 0.5, f: null } });
  wb.setCells(wb.activeSheetId, cells);
  return wb;
}

// The .ods writer stored every entry uncompressed, so a sheet of numbers saved as .ods was
// about ten times the size of the same sheet as .xlsx. The entries are deflated now, except
// the mimetype entry, which OpenDocument (ODF 1.2 part 3, 3.3) wants first in the package
// and stored, so a reader can identify the file from its first bytes.
it('deflates the entries of an .ods and keeps the mimetype entry first and stored', async () => {
  const wb = book(2000, 8);
  const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
  const list = entries(bytes);
  expect(list[0]).toMatchObject({ name: 'mimetype', method: 0, offset: 0, extraLength: 0, size: 46 });
  expect(new TextDecoder().decode(bytes.subarray(38, 38 + 46))).toBe('application/vnd.oasis.opendocument.spreadsheet');
  const content = list.find((e) => e.name === 'content.xml');
  expect(content.method).toBe(8);
  expect(content.compressed).toBeLessThan(content.size / 4);
  expect(list.filter((e) => e.name !== 'mimetype').every((e) => e.method === 8)).toBe(true);
  const xlsx = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  expect(bytes.length).toBeLessThan(xlsx.length * 3);
  // The package still opens, through this reader as through any other.
  const back = await workbookFromFile(bytes, 'numbers.ods');
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe(0.5);
  expect(back.getValue(back.activeSheetId, 1999, 7)).toBe(1999007.5);
  expect(back.activeSheet.cells.size).toBe(16000);
});

it('keeps a settings-free export the same shape, with the mimetype entry first', async () => {
  const bytes = new Uint8Array(await (await workbookToOds(book(3, 2), { settings: false })).arrayBuffer());
  const list = entries(bytes);
  expect(list[0].name).toBe('mimetype');
  expect(list.map((e) => e.name)).not.toContain('settings.xml');
  expect(list.every((e) => e.name === 'mimetype' ? e.method === 0 : e.method === 8)).toBe(true);
});
