import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['Data_x0041_', '_x005F_', '_x0041_x0042_', "O'Brien_x0041_", 'A & B_x0041_', '😀_x0041_', 'Plain Data'].flatMap((name) =>
  ['Jump', '', 'See _x0041_'].map((label) => ({ name, label }))))(
  'keeps internal destinations consistent with worksheet names: %j', async ({ name, label }) => {
    const target = `#'${name.replaceAll("'", "''")}'!B2`;
    let book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: label, l: { Target: target } } }, 'Index');
    XLSX.utils.book_append_sheet(book, { '!ref': 'B2', B2: { t: 'n', v: 42 } }, name);
    let bytes;
    for (let round = 0; round < 3; ++round) {
      bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
      book = XLSX.read(bytes, { type: 'array' });
      expect(book.Sheets.Index.A1.l.Target).toBe(target);
      expect(book.SheetNames).toEqual(['Index', name]);
    }
    let wb = await workbookFromFile(bytes, 'internal.xlsx');
    for (let round = 0; round < 2; ++round) {
      const link = wb.linkAt(wb.sheetByName('Index').id, 0, 0);
      expect(link).toEqual({ url: target, label: label || target });
      expect(wb.resolveLink(link.url)).toMatchObject({ sheetId: wb.sheetByName(name).id, range: { r1: 1, c1: 1, r2: 1, c2: 1 } });
      wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    }
  },
);

it.each(['_x0041_', '_x005F_', '_x0041_x0042_', 'anchor_x000D_', '😀_x0041_', 'literal&amp;_x0041_', 'ordinary-anchor'])(
  'preserves literal fragments in external hyperlinks: %s', async (fragment) => {
    const target = `https://example.com/_x0041_?a=1&b=2#${fragment}`;
    let book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Open', l: { Target: target } } }, 'Data');
    let bytes;
    for (let round = 0; round < 3; ++round) {
      bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
      book = XLSX.read(bytes, { type: 'array' });
      expect(book.Sheets.Data.A1.l.Target).toBe(target);
    }
    let wb = await workbookFromFile(bytes, 'external.xlsx');
    expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(target);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(target);
  },
);

it.each(['', 'https://example.com/'].flatMap((base) => [
  ['_x0041_', 'A'], ['_x005F_x0041_', '_x0041_'], ['&amp;amp;', '&amp;'], ['&#x1F600;', '😀'],
].map(([encoded, expected]) => ({ base, encoded, expected }))))(
  'continues decoding genuine Xstring locations from external files: %j', async ({ base, encoded, expected }) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Open', l: { Target: `${base}#SENTINEL` } } }, 'Data');
    const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
    const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml');
    entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('location="SENTINEL"', `location="${encoded}"`));
    entry.size = entry.content.length;
    const wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'encoded.xlsx');
    expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(`${base}#${expected}`);
  },
);
