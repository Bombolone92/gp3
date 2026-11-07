import { expect, it } from 'vitest';
import { formatValue, numFmtToStyle, styleToNumFmt } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

const cases = [
  ['#,##0.00_);(#,##0.00)', -1234.5, '(1,234.50)'],
  ['#,##0.00_);(#,##0.00)', 1234.5, '1,234.50 '],
  ['"$"#,##0.0;-"$"#,##0.000', -1234.5, '-$1,234.500'],
  ['"$"#,##0.0;-"$"#,##0.000', 1234.5, '$1,234.5'],
  ['[$CHF-807] #,##0.00', 1234.5, 'CHF 1,234.50'],
  ['[$kr-41D]#,##0.0', -1234.5, '-kr1,234.5'],
  ['[$€-407] #,##0.00', 1234.5, '€ 1,234.50'],
  ['0.00E+0', 1234.5, '1.23E+3'],
  ['0.00E+000', 1234.5, '1.23E+003'],
  ['0.00E+000', 0.0012345, '1.23E-003'],
  [' 0.00 ', 1234.5, ' 1234.50 '],
  [' 0.0% ', 0.125, ' 12.5% '],
];

it.each(cases)('preserves numeric code %s for %s', (code, value, display) => {
  const style = numFmtToStyle(code);
  expect(formatValue(value, style)).toBe(display);
  expect(styleToNumFmt(style)).toBe(code);
});

it('keeps ordinary number, currency, percent, and scientific codes as named styles', () => {
  expect(numFmtToStyle('#,##0.00')).toEqual({ fmt: 'number', dec: 2, group: true });
  expect(numFmtToStyle('0.00')).toEqual({ fmt: 'number', dec: 2, group: false });
  expect(numFmtToStyle('"$"#,##0.00')).toEqual({ fmt: 'currency', dec: 2, cur: 'USD' });
  expect(numFmtToStyle('£#,##0')).toEqual({ fmt: 'currency', dec: 0, cur: 'GBP' });
  expect(numFmtToStyle('0.0%')).toEqual({ fmt: 'percent', dec: 1, group: false });
  expect(numFmtToStyle('0.00E+00')).toEqual({ fmt: 'scientific', dec: 2 });
});

it('preserves numeric formatting in an external XLSX through import and export', async () => {
  const sheet = XLSX.utils.aoa_to_sheet(cases.map(([z, v]) => [{ t: 'n', v, z }]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Numbers');
  const imported = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'numbers.xlsx');
  for (const [r, [, value, display]] of cases.entries()) {
    expect(imported.getValue(imported.activeSheetId, r, 0)).toBe(value);
    expect(imported.getDisplay(imported.activeSheetId, r, 0)).toBe(display);
  }
  const exported = XLSX.read(await (await workbookToXlsx(imported)).arrayBuffer(), { type: 'array', cellNF: true });
  for (const [r, [code, value]] of cases.entries()) {
    expect(exported.Sheets.Numbers[`A${r + 1}`].z).toBe(code);
    expect(exported.Sheets.Numbers[`A${r + 1}`].v).toBe(value);
  }
});
