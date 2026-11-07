import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { ymdToSerial } from '../src/core/format.js';

it.each([false, true])('preserves imported calendar dates with the 1904 date system set to %s', async (date1904) => {
  const day = ymdToSerial(2024, 1, 15);
  const rawDay = day - (date1904 ? 1462 : 0);
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904 } };
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:H2',
    A1: { t: 'n', v: rawDay, z: 'yyyy-mm-dd' },
    B1: { t: 'n', v: rawDay + 0.5, z: 'yyyy-mm-dd hh:mm' },
    C1: { t: 'n', v: rawDay, z: '"Due: "dd mmm yyyy' },
    D1: { t: 'n', v: 0.5, z: 'hh:mm' },
    E1: { t: 'n', v: 1.5, z: '[h]:mm' },
    F1: { t: 'n', v: 42, z: '0.00' },
    G1: { t: 'n', v: 2, z: '0 "days"' },
    H1: { t: 'n', v: rawDay, z: 'mmmm' },
    A2: { t: 'n', f: 'A1+1', v: rawDay + 1, z: 'yyyy-mm-dd' },
    B2: { t: 'n', f: 'YEAR(A1)', v: 2024 },
  }, 'Dates');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'dates.xlsx');
  for (const roundTrip of [false, true]) {
    const back = roundTrip ? await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx') : wb;
    const id = back.activeSheetId;
    expect(back.getValue(id, 0, 0)).toBe(day);
    expect(back.getDisplay(id, 0, 0)).toBe('2024-01-15');
    expect(back.getValue(id, 0, 1)).toBe(day + 0.5);
    expect(back.getDisplay(id, 0, 1)).toBe('2024-01-15 12:00');
    expect(back.getDisplay(id, 0, 2)).toBe('Due: 15 Jan 2024');
    expect(back.getValue(id, 0, 3)).toBe(0.5);
    expect(back.getValue(id, 0, 4)).toBe(1.5);
    expect(back.getValue(id, 0, 5)).toBe(42);
    expect(back.getValue(id, 0, 6)).toBe(2);
    expect(back.getValue(id, 0, 7)).toBe(day);
    expect(back.getDisplay(id, 1, 0)).toBe('2024-01-16');
    expect(back.getValue(id, 1, 1)).toBe(2024);
  }
});
