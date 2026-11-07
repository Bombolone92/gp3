import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { ymdToSerial } from '../src/core/format.js';

it('keeps standalone month, weekday, and year formats when reopening files', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:C1',
    A1: { t: 'n', v: ymdToSerial(2024, 1, 15), z: 'mmmm' },
    B1: { t: 'n', v: ymdToSerial(2024, 1, 15), z: 'dddd' },
    C1: { t: 'n', v: ymdToSerial(2024, 1, 15), z: 'yyyy' },
  }, 'Dates');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'dates.xlsx');
  for (const back of [wb, await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx')]) {
    expect([0, 1, 2].map((c) => back.getDisplay(back.activeSheetId, 0, c))).toEqual(['January', 'Monday', '2024']);
  }
});
