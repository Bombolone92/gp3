import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [1e21, '0', '1000000000000000000000'],
  [1e21, '0.00', '1000000000000000000000.00'],
  [-1e21, '0.00', '-1000000000000000000000.00'],
  [1e21, '#,##0.00', '1,000,000,000,000,000,000,000.00'],
  [1e21, '000-000', '1000000000000000000-000'],
  [1e21, '0.###', '1000000000000000000000.'],
  [1e21, '0.???', '1000000000000000000000.   '],
  [1e21, '0.0"x"00', '1000000000000000000000.0x00'],
  [1e21, '0.00,,"M"', '1000000000000000.00M'],
  [1e19, '0.00%', '1000000000000000000000.00%'],
  [2 ** 80, '0', '1208925819614630000000000'],
  [2 ** 80, '0.00', '1208925819614630000000000.00'],
  [-(2 ** 80), '0;[Red](0)', '(1208925819614630000000000)'],
  [2 ** 80, '#,##0', '1,208,925,819,614,630,000,000,000'],
  [1e20, '0.00', '100000000000000000000.00'],
  [1000000000000000100, '0.00', '1000000000000000000.00'],
  [1e21, '0.00E+00', '1.00E+21'],
  [1234.567, '0.00', '1234.57'],
])('keeps %s in fixed notation with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('prints the largest finite integer in fixed notation to fifteen significant digits', () => {
  expect(formatWithCode(Number.MAX_VALUE, '0.00')).toBe(`179769313486232${'0'.repeat(294)}.00`);
});

it('uses locale separators for large fixed numbers', () => {
  const previous = getLocale();
  try {
    setLocale('de-DE');
    expect(formatWithCode(1e21, '#,##0.00')).toBe('1.000.000.000.000.000.000.000,00');
  } finally { setLocale(previous); }
});

it('keeps large values intact in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 2 ** 80, { literal: true });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.00' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.00")');
  expect(wb.getDisplay(id, 0, 0)).toBe('1208925819614630000000000.00');
  expect(wb.getValue(id, 0, 1)).toBe('1208925819614630000000000.00');
  expect(wb.getValue(id, 0, 0)).toBe(2 ** 80);
});
