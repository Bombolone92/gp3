import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [1234.5, '#,##0 ?/?', '1,234 1/2'],
  [1234.25, '#,##0 ?/8', '1,234 2/8'],
  [-1234.5, '#,##0 ?/?', '-1,234 1/2'],
  [999.99, '#,##0 ?/?', '1,000    '],
  [2.75, '000 ?/?', '002 3/4'],
  [0.75, '000 ?/?', '000 3/4'],
  [0, '000 ?/?', '000    '],
  [1.99, '000 ?/?', '002    '],
  [2.75, '??0 ?/?', '  2 3/4'],
  [0.75, '#0 ?/?', '0 3/4'],
  [2.75, '0# ?/?', '02 3/4'],
  [2.75, '0?0 ?/?', '0 2 3/4'],
  [1234.5, '"$"#,##0 ?/?" kg"', '$1,234 1/2 kg'],
  [-1234.5, '#,##0 ?/?;[Red](#,##0 ?/?)', '(1,234 1/2)'],
  [12.345, '#,##0 ?/?%', '1,234 1/2%'],
  [0.0275, '0%0 ?/?', '0%2 3/4'],
  [2.75, '000" and "?/?', '002 and 3/4'],
  [1e21, '# ?/?', '1000000000000000000000    '],
  [0.75, '# ?/?', ' 3/4'],
  [0, '# ?/?', '0    '],
  [2.75, '??/??', '11/4 '],
])('formats the whole part of %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('uses localized grouping in the whole part of a mixed fraction', () => {
  const previous = getLocale();
  try {
    setLocale('de-DE');
    expect(formatWithCode(1234.5, '#,##0 ?/?')).toBe('1.234 1/2');
  } finally { setLocale(previous); }
});

it('keeps whole-part styling consistent in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1234.5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '#,##0 ?/?' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"#,##0 ?/?")');
  expect(wb.getDisplay(id, 0, 0)).toBe('1,234 1/2');
  expect(wb.getValue(id, 0, 1)).toBe('1,234 1/2');
  expect(wb.getValue(id, 0, 0)).toBe(1234.5);
});
