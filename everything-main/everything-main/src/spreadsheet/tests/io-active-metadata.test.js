import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function file(active) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42, 'Keep this cell']]), 'Data');
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', f: 'Data!A1*2', v: 84 } }, 'Other');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[99]]), '42');
  const meta = { v: 1, active, sheets: { Data: { styles: { '0,0': { bold: true } } } } };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[JSON.stringify(meta)]]), META_SHEET);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

it.each([
  { toString: null },
  { toString: 42 },
  { toString: {}, valueOf: null },
  [{ toString: false }],
  ['Other'],
  42,
  true,
  false,
  null,
])('ignores malformed active-sheet metadata %j without losing workbook data', async (active) => {
  const wb = await workbookFromFile(file(active), 'metadata.xlsx');
  for (const roundTrip of [false, true]) {
    const back = roundTrip ? await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx') : wb;
    expect(back.activeSheet.name).toBe('Data');
    expect(back.sheets.map((s) => s.name)).toEqual(['Data', 'Other', '42']);
    expect(back.getValue(back.sheetByName('Data').id, 0, 0)).toBe(42);
    expect(back.getValue(back.sheetByName('Data').id, 0, 1)).toBe('Keep this cell');
    expect(back.getCell(back.sheetByName('Data').id, 0, 0).s.bold).toBe(true);
    expect(back.getValue(back.sheetByName('Other').id, 0, 0)).toBe(84);
    expect(back.getValue(back.sheetByName('42').id, 0, 0)).toBe(99);
    expect(back.dirty).toBe(false);
  }
});

it.each([
  ['Other', 'Other'],
  ['other', 'Other'],
  ['42', '42'],
  ['missing', 'Data'],
  ['', 'Data'],
])('restores the valid active-sheet hint %s with a safe fallback', async (active, expected) => {
  const wb = await workbookFromFile(file(active), 'metadata.xlsx');
  expect(wb.activeSheet.name).toBe(expected);
});
