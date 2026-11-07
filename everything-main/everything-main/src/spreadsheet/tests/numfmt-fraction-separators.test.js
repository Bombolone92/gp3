import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [2.75, '# "and" ?/?', '2 and 3/4'],
  [2.75, '#" and "?/?', '2 and 3/4'],
  [2.75, '#"  "?/?', '2  3/4'],
  [2.75, '#  ?/?', '2  3/4'],
  [2.75, '0" whole "?/?', '2 whole 3/4'],
  [2.75, '#"x"?/?', '2x3/4'],
  [2.75, '#\\-?/?', '2-3/4'],
  [2.75, '#" and "?/8', '2 and 6/8'],
  [-2.75, '# "and" ?/?', '-2 and 3/4'],
  [-2.75, '# ?/?;[Red](#" and "?/?)', '(2 and 3/4)'],
  [0.75, '# "and" ?/?', '     3/4'],
  [2, '# "and" ?/?', '2        '],
  [1.99, '# "and" ?/?', '2        '],
  [2.75, '"USD "# "and" ?/?" kg"', 'USD 2 and 3/4 kg'],
  [0.0275, '#% ?/?', '2% 3/4'],
  [2.75, '# ?/?', '2 3/4'],
  [0.75, '# ?/?', ' 3/4'],
  [2, '# ?/?', '2    '],
  [2.75, '"USD "??/??', 'USD 11/4 '],
])('preserves the separator between whole and fractional parts for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('preserves internal fraction labels in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2.75');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '# "and" ?/?' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"# ""and"" ?/?")');
  expect(wb.getDisplay(id, 0, 0)).toBe('2 and 3/4');
  expect(wb.getValue(id, 0, 1)).toBe('2 and 3/4');
  expect(wb.getValue(id, 0, 0)).toBe(2.75);
});
