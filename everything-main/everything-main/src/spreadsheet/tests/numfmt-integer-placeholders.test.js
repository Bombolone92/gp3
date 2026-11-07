import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [5, '0#', '05'],
  [5, '#0#', '05'],
  [5, '0?', '05'],
  [5, '?0?', ' 05'],
  [5, '0??', '0 5'],
  [12, '0??', '012'],
  [12, '#?##0', ' 12'],
  [5, '?##', ' 5'],
  [12, '?##', ' 12'],
  [12, '?#?', ' 12'],
  [5, '0"-"##', '0-5'],
  [12, '0"-"##', '0-12'],
  [0, '0"-"##', '0-'],
  [0, '0??', '0  '],
  [0, '0?0', '0 0'],
  [0, '0"x"?"y"0', '0x y0'],
  [0, '0##', '0'],
  [0, '?##', ' '],
  [0, '?#?', '  '],
  [0, '###', ''],
  [0.5, '0##.0', '0.5'],
  [0.5, '0??.0', '0  .5'],
  [5, '?"x"##', ' x5'],
  [12, '??0', ' 12'],
  [1234, '0??', '1234'],
  [12345, '?##,##0', ' 12,345'],
  [5, '0,000', '0,005'],
  [0, '0,0"x"?"y"0', '0,0x y0'],
  [0, '0,000', '0,000'],
  [-5, '0"-"##', '-0-5'],
  [-5, '0"-"##;[Red](0"-"##)', '(0-5)'],
  [0.05, '0#%', '05%'],
])('places integer digits and padding correctly for %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('uses positional integer placeholders in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0??' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0??")');
  expect(wb.getDisplay(id, 0, 0)).toBe('0 5');
  expect(wb.getValue(id, 0, 1)).toBe('0 5');
  expect(wb.getValue(id, 0, 0)).toBe(5);
});
