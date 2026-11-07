import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [1e23, '0', '100000000000000000000000'],
  [1e23, '0.00', '100000000000000000000000.00'],
  [2 ** 70, '0', '1180591620717410000000'],
  [2 ** 70, '0.00', '1180591620717410000000.00'],
  [-(2 ** 70), '0', '-1180591620717410000000'],
  [-(2 ** 70), '0;[Red](0)', '(1180591620717410000000)'],
  [2 ** 80, '#,##0', '1,208,925,819,614,630,000,000,000'],
  [1e300, '0%', `1${'0'.repeat(302)}%`],
  [1e21, '0', '1000000000000000000000'],
  [9.999999999999999e22, '0', '100000000000000000000000'],
  [1.2345678901234567e25, '0', '12345678901234600000000000'],
  [1e24, '0,,"M"', '1000000000000000000M'],
  [1e23, '000-000', '100000000000000000000-000'],
])('prints %s with %s to fifteen significant digits, then zeros', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('prints the largest finite number in fixed notation without its binary expansion', () => {
  expect(formatWithCode(Number.MAX_VALUE, '0')).toBe(`179769313486232${'0'.repeat(294)}`);
  expect(formatWithCode(Number.MAX_VALUE, '0.0')).toBe(`179769313486232${'0'.repeat(294)}.0`);
});

it('agrees with the Number preset for a round power of ten', () => {
  expect(formatWithCode(1e23, '#,##0')).toBe(formatValue(1e23, { fmt: 'number', dec: 0 }));
});

it('gives TEXT and the cell the same digits', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 1e23, { literal: true });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0' });
  wb.setInput(id, 0, 1, '=TEXT(1E23,"0")');
  expect(wb.getDisplay(id, 0, 0)).toBe('100000000000000000000000');
  expect(wb.getValue(id, 0, 1)).toBe('100000000000000000000000');
});
