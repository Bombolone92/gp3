import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const variants = [
  { name: 'stub', cell: { t: 'z' } },
  { name: 'null stub', cell: { t: 'z', v: null } },
  { name: 'untyped empty cell', cell: {} },
  { name: 'string without a value', cell: { t: 's' } },
  { name: 'formatted stub', cell: { t: 'z', v: null, z: '0.00' } },
  { name: 'empty string', cell: { t: 's', v: '' } },
];

it.each(variants.flatMap((variant) => [false, true].flatMap((dense) => [false, true].flatMap((sheetStubs) =>
  ['https://example.com/blank_x0041_', '#Data!B1'].map((target) => ({ ...variant, dense, sheetStubs, target }))))))(
  'retains a hyperlink on a $name (dense=$dense, sheetStubs=$sheetStubs, target=$target)', async ({ cell, dense, sheetStubs, target }) => {
    let book = XLSX.utils.book_new();
    const linked = { ...cell, l: { Target: target } };
    const control = { t: 'n', v: 17 };
    XLSX.utils.book_append_sheet(book, dense ? { '!ref': 'A1:B1', '!data': [[linked, control]] } : { '!ref': 'A1:B1', A1: linked, B1: control }, 'Data');
    let bytes;
    for (let round = 0; round < 3; ++round) {
      bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx', sheetStubs });
      book = XLSX.read(bytes, { type: 'array', dense, sheetStubs: true, cellNF: true });
      const row = dense ? book.Sheets.Data['!data'][0] : [book.Sheets.Data.A1, book.Sheets.Data.B1];
      expect(row[0]?.l?.Target).toBe(target);
      expect(row[0].v == null || row[0].v === '').toBe(true);
      expect(row[1].v).toBe(17);
      if (cell.z) expect(row[0].z).toBe(cell.z);
    }
    let wb = await workbookFromFile(bytes, 'blank-link.xlsx');
    expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(target);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(target);
  },
);

it('retains imported hyperlink-only cells outside the original dimension through direct saves', async () => {
  let book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Keep']]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('</worksheet>',
    '<hyperlinks><hyperlink ref="C5:D6" location="Data!A1"/></hyperlinks></worksheet>'));
  entry.size = entry.content.length;
  book = XLSX.read(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), { type: 'array' });
  for (let round = 0; round < 3; ++round) {
    book = XLSX.read(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    for (const address of ['C5', 'D5', 'C6', 'D6']) expect(book.Sheets.Data[address]?.l?.Target).toBe('#Data!A1');
    expect(book.Sheets.Data.A1.v).toBe('Keep');
  }
});

it.each([
  { t: 'n', v: 42 }, { t: 'b', v: false }, { t: 's', v: 'Label' },
  { t: 'd', v: new Date('2024-01-15T00:00:00Z') }, { t: 'n', v: 2, f: '1+1' },
])('writes one hyperlink for an ordinary populated cell: %j', (cell) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { ...cell, l: { Target: 'https://example.com/valid' } } }, 'Data');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const xml = new TextDecoder().decode(zip.FileIndex.find((e) => e.name === 'sheet1.xml').content);
  expect(xml.match(/<hyperlink\b/g)).toHaveLength(1);
  const back = XLSX.read(bytes, { type: 'array' });
  expect(back.Sheets.Data.A1.l.Target).toBe('https://example.com/valid');
});
