import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { ymdToSerial } from '../src/core/format.js';

// A 1904-system file's cells were moved to this app's 1900 serials, but a defined name holding
// a date serial (Anniversary = 30000) was not, so =Anniversary in a date cell showed 1982-02-18
// where Excel shows 1986-02-19. Nothing in the file says which bare numbers are dates; the
// cells reading a name tell: one read by a date-formatted cell, and by no cell of another
// number format, moves with the cells. What this cannot tell (a name read only through
// functions in plain cells, a name used both as a date and as a number) stays as it is.
function file(date1904, cells) {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904 }, Names: [
    { Name: 'Anniversary', Ref: '30000' },
    { Name: 'Periods', Ref: '12' },
    { Name: 'Rate', Ref: '0.07' },
    { Name: 'Threshold', Ref: '100' },
    { Name: 'Hidden', Ref: '31000' },
    { Name: 'Start', Ref: '30000', Sheet: 0 },
  ] };
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1:H1', ...cells }, 'Data');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}
const CELLS = {
  A1: { t: 'n', f: 'Anniversary', v: 30000, z: 'yyyy-mm-dd' },
  B1: { t: 'n', f: 'YEAR(Anniversary)', v: 1986 },
  C1: { t: 'n', f: 'Start+Periods', v: 30012, z: 'd mmm yyyy' },
  D1: { t: 'n', f: 'Periods*Rate', v: 0.84, z: '0.00' },
  E1: { t: 'n', f: 'Threshold*2', v: 200 },
  F1: { t: 'n', f: 'DATEDIF(Hidden,TODAY(),"y")', v: 1 },
  G1: { t: 'n', f: 'Rate', v: 0.07, z: '0%' },
};
const named = (wb, name) => wb.names.find((n) => n.name === name).ref;

it('moves a bare-number name that date-formatted cells read, with the cells, in a 1904 file', async () => {
  const wb = await workbookFromFile(file(true, CELLS), 'mac.xlsx');
  const id = wb.activeSheetId;
  expect(named(wb, 'Anniversary')).toBe('31462');
  expect(wb.getValue(id, 0, 0)).toBe(ymdToSerial(1986, 2, 19));
  expect(wb.getDisplay(id, 0, 0)).toBe('1986-02-19');
  expect(wb.getValue(id, 0, 1)).toBe(1986);
  // A sheet-scoped name is judged the same way; Periods sits in a date cell beside it but also in a number cell.
  expect(named(wb, 'Start')).toBe('31462');
  expect(named(wb, 'Periods')).toBe('12');
  expect(wb.getDisplay(id, 0, 2)).toBe('3 Mar 1986'); // 19 Feb 1986 + 12 days
  expect(wb.getValue(id, 0, 3)).toBeCloseTo(0.84);
  // Below 1, or read by no date cell, a number is left alone: the limit of what the file tells.
  expect(named(wb, 'Rate')).toBe('0.07');
  expect(named(wb, 'Threshold')).toBe('100');
  expect(named(wb, 'Hidden')).toBe('31000');
  // Saved by this app the file is on the 1900 system, so nothing moves twice.
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(named(back, 'Anniversary')).toBe('31462');
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('1986-02-19');
});

it('leaves every name as it is in a 1900 file', async () => {
  const wb = await workbookFromFile(file(false, CELLS), 'pc.xlsx');
  expect(wb.names.map((n) => n.ref)).toEqual(['30000', '12', '0.07', '100', '31000', '30000']);
  expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe('1982-02-18');
});
