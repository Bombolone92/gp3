import { expect, it } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';
import { ymdToSerial } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

const day = ymdToSerial(2024, 3, 5);

const cases = [
  [day, '[DBNum1][$-804]yyyy"年"m"月"d"日"', '二○二四年三月五日'],
  [day, '[DBNum2][$-804]yyyy"年"m"月"d"日"', '贰零贰肆年叁月伍日'],
  [day, '[DBNum3]yyyy-mm-dd', '2024-03-05'],
  [day, '[NatNum1]yyyy-mm-dd', '#####'],
  [5, '[NatNum]0', '#####'],
  [5, '[NatNum12]0.0', '#####'],
  [day, '[~buddhist]yyyy-mm-dd', '#####'],
  [day, '[~gengou]d mmm yyyy', '#####'],
  [day, '[HIJ]dd/mm/yyyy', '#####'],
  [day, '[ENG][$-409]dddd, mmmm d', '#####'],
  [day, '[JPN]yyyy"年"', '#####'],
  [5, '[Color 10]0', '5'],
  [5, '[Color10]0', '5'],
  [-5, '0;[Color 3]-0', '-5'],
  [day, '[$-F800]dddd, mmmm dd, yyyy', 'Tuesday, March 5, 2024'],
  [1234.5, '[DBNum1]#,##0.00', '1,234.50'],
];

it.each(cases)('formats %s with bracket directive %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps colours and conditions working beside recognized directives', () => {
  expect(codeColor(5, '[Red][DBNum1]0')).toBe(codeColor(5, '[Red]0'));
  expect(codeColor(-5, '0;[DBNum1][Red]-0')).toBe(codeColor(-5, '0;[Red]-0'));
  expect(formatWithCode(150, '[DBNum1][>=100]0"+";0')).toBe('150+');
  expect(formatWithCode(1.5, '[NatNum1][h]:mm')).toBe('#####');
  expect(formatWithCode(5, '[Blue]0" [ENG]"')).toBe('5 [ENG]');
  expect(formatWithCode('x', '[DBNum1]@" [kg]"')).toBe('x [kg]');
});

it('preserves directive-bearing values and codes through XLSX, including invalid codes', async () => {
  const sheet = XLSX.utils.aoa_to_sheet(cases.map(([v, z]) => [{ t: 'n', v, z }]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Directives');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'directives.xlsx');
  for (const [r, [value, , expected]] of cases.entries()) {
    expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(value);
    expect(wb.getDisplay(wb.activeSheetId, r, 0)).toBe(expected);
  }
  const exported = XLSX.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array', cellNF: true });
  for (const [r, [value, code]] of cases.entries()) {
    expect(exported.Sheets.Directives[`A${r + 1}`].v).toBe(value);
    expect(exported.Sheets.Directives[`A${r + 1}`].z).toBe(code);
  }
});
