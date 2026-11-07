import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { ymdToSerial } from '../src/core/format.js';

const day = ymdToSerial(2024, 1, 15);
const cases = [
  [42, '0;yyyy-mm-dd', 42, '42'],
  [42, '[<100]0;yyyy-mm-dd', 42, '42'],
  [42, '0;0;yyyy-mm-dd', 42, '42'],
  [-42, 'yyyy-mm-dd;0', -42, '42'],
  [0, 'yyyy-mm-dd;yyyy-mm-dd;0', 0, '0'],
  [500, '[<100]0;[>10000]yyyy-mm-dd;0', 500, '500'],
  [0.5, 'hh:mm;yyyy-mm-dd', 0.5, '12:00'],
  [1.5, '[h]:mm;yyyy-mm-dd', 1.5, '36:00'],
  [42, '0" days"', 42, '42 days'],
  [day - 1462, 'yyyy-mm-dd;[h]:mm', day, '2024-01-15'],
  [day - 1462 + 0.5, 'yyyy-mm-dd hh:mm;[s]', day + 0.5, '2024-01-15 12:00'],
  [day - 1462, '[>10000]yyyy-mm-dd;[h]:mm', day, '2024-01-15'],
  [day - 1462, 'mmmm;[h]:mm', day, 'January'],
  [day - 1462, '[>10000]yyyy-mm-dd;0', day, '2024-01-15'],
];

function file(value, code, date1904) {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904 } };
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1',
    A1: { t: 'n', v: value, z: code },
    B1: { t: 'n', f: 'A1+1', v: value + 1 },
  }, 'Data');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

it.each(cases)('normalizes 1904 serial %s using its selected format section in %s', async (value, code, expected, display) => {
  const wb = await workbookFromFile(file(value, code, true), '1904.xlsx');
  for (const roundTrip of [false, true]) {
    const back = roundTrip ? await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx') : wb;
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(expected);
    expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe(display);
    expect(back.getValue(back.activeSheetId, 0, 1)).toBe(expected + 1);
  }
});

it('does not adjust any source values in a 1900-system workbook', async () => {
  for (const [value, code] of cases) {
    const wb = await workbookFromFile(file(value, code, false), '1900.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(value);
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(value + 1);
  }
});
