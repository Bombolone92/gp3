import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [0, '???,???', '       '],
  [5, '???,???', '      5'],
  [12, '???,???', '     12'],
  [123, '???,???', '    123'],
  [1234, '???,???', '  1,234'],
  [123456, '???,???', '123,456'],
  [5, '??,000', '   005'],
  [1234, '??,000', ' 1,234'],
  [5, '?##,##0', '  5'],
  [12, '?##,##0', '  12'],
  [1234, '?##,##0', ' 1,234'],
  [0, '0,0?0', '0,0 0'],
  [5, '0,0?0', '0,0 5'],
  [5, '???,??0.00', '      5.00'],
  [5, '???,??0" kg"', '      5 kg'],
  [-5, '???,??0;[Red](???,??0)', '(      5)'],
  [5, '???,???,???', '          5'],
  [0.05, '???,??0%', '      5%'],
  [5000, '???,??0,"K"', '      5K'],
  [5, '###,###', '5'],
  [0, '###,###', ''],
  [1234567, '#,##0', '1,234,567'],
  [5, '000,000', '000,005'],
])('preserves grouped integer positions for %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps grouped columns the same width as values grow', () => {
  for (const value of [0, 5, 12, 123, 1234, 12345, 123456]) {
    expect(formatWithCode(value, '???,???').length).toBe(7);
  }
});

it('localizes visible separators while padding absent separators with spaces', () => {
  const previous = getLocale();
  try {
    setLocale('de-DE');
    expect(formatWithCode(1234.5, '???,??0.00')).toBe('  1.234,50');
    expect(formatWithCode(5, '???,??0.00')).toBe('      5,00');
  } finally { setLocale(previous); }
});

it('keeps grouping alignment consistent in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '???,??0' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"???,??0")');
  expect(wb.getDisplay(id, 0, 0)).toBe('      5');
  expect(wb.getValue(id, 0, 1)).toBe('      5');
  expect(wb.getValue(id, 0, 0)).toBe(5);
});
