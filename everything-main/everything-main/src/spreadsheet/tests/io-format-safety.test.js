import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { formatValue } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';

it.each([
  { fmt: 'number', dec: -1 },
  { fmt: 'percent', dec: 'Infinity' },
  { fmt: 'scientific', dec: 1000 },
  { fmt: 'currency', cur: 'INVALID' },
])('can display and save imported cells with malformed format settings %j', async (style) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42.5]]), 'Data');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[JSON.stringify({
    v: 1, sheets: { Data: { styles: { '0,0': style } } },
  })]]), META_SHEET);
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'untrusted.xlsx');
  expect(wb.getDisplay(wb.activeSheetId, 0, 0)).not.toContain('NaN');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe(42.5);
  expect(back.getDisplay(back.activeSheetId, 0, 0)).not.toContain('NaN');
});

it('formats more than 100 decimal placeholders without exceeding toFixed limits', () => {
  const code = `0.${'0'.repeat(101)}`;
  const expected = `42.5${'0'.repeat(100)}`;
  expect(formatWithCode(42.5, code)).toBe(expected);
  expect(formatValue(42.5, { fmt: 'custom', code })).toBe(expected);
});
