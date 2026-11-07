import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

const cases = [
  [1234567890, '000-000-0000', '123-456-7890'],
  [1234567890, '(000) 000-0000', '(123) 456-7890'],
  [123456789, '000-00-0000', '123-45-6789'],
  [123456789, '00000-0000', '12345-6789'],
  [12345, '00"-"000', '12-345'],
  [5, '0\\;0', '0;5'],
  [5, '00"-"00', '00-05'],
  [0, '00"-"00', '00-00'],
  [1234567, '00"-"00', '12345-67'],
  [5, '##"-"00', '-05'],
  [5, '??"-"00', '  -05'],
  [5, '0_;0', '0 5'],
  [-12345, '00"-"000', '-12-345'],
  [-12345, '00"-"000;[Red](00"-"000)', '(12-345)'],
  [12.345, '0.0"x"00', '12.3x45'],
  [12.3, '0.0"x"##', '12.3x'],
  [12.3, '0.0"x"0?', '12.3x0 '],
  [12345.678, '0.0"x"00E+00', '1.2x35E+04'],
  [0.12345, '0.0"x"00%', '12.3x45%'],
  [12345.67, '#,##0.0"x"0', '12,345.6x7'],
];

it.each(cases)('keeps digits on either side of literals for %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps localized grouping and decimal marks around embedded literals', () => {
  const previous = getLocale();
  try {
    setLocale('de-DE');
    expect(formatWithCode(12345.67, '#,##0.0"x"0')).toBe('12.345,6x7');
  } finally { setLocale(previous); }
});

it('keeps large integers in fixed notation when distributing digits across placeholders', () => {
  expect(formatWithCode(Number.MAX_VALUE, '0.00')).toBe(`179769313486232${'0'.repeat(294)}.00`);
  expect(formatWithCode(1e23, '000-000')).toBe('100000000000000000000-000');
});

it('uses the same positional formatting in cell display and TEXT without changing the stored number', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234567890');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '(000) 000-0000' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"(000) 000-0000")');
  expect(wb.getDisplay(id, 0, 0)).toBe('(123) 456-7890');
  expect(wb.getValue(id, 0, 1)).toBe('(123) 456-7890');
  expect(wb.getValue(id, 0, 0)).toBe(1234567890);
});

it('preserves embedded digit literals in external XLSX files through import and export', async () => {
  const sheet = XLSX.utils.aoa_to_sheet(cases.map(([v, z]) => [{ t: 'n', v, z }]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Codes');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'codes.xlsx');
  for (const [r, [value, , display]] of cases.entries()) {
    expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(value);
    expect(wb.getDisplay(wb.activeSheetId, r, 0)).toBe(display);
  }
  const exported = XLSX.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array', cellNF: true });
  for (const [r, [value, code]] of cases.entries()) {
    expect(exported.Sheets.Codes[`A${r + 1}`].v).toBe(value);
    expect(exported.Sheets.Codes[`A${r + 1}`].z).toBe(code);
  }
});
