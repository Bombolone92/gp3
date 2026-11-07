import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [Number.MIN_VALUE, '0.00E+00', '4.94E-324'],
  [-Number.MIN_VALUE, '0.00E+00', '-4.94E-324'],
  [2 * Number.MIN_VALUE, '0.00E+00', '9.88E-324'],
  [3 * Number.MIN_VALUE, '0.00E+00', '1.48E-323'],
  [1e-320, '0.00E+00', '1.00E-320'],
  [1e-308, '0.00E+00', '1.00E-308'],
  [Number.MIN_VALUE, '000.0E+00', '004.9E-324'],
  [1e-320, '000.0E+00', '010.0E-321'],
  [Number.MIN_VALUE, '0.00E+00%', '4.94E-324%'],
  [Number.MAX_VALUE, '0.00E+00%', '1.80E+308%'],
  [Number.MIN_VALUE, '0.00,E+00', '4.94E-324'],
  [Number.MAX_VALUE, '0.00,,E+00', '1.80E+308'],
  [Number.MAX_VALUE, '0.00E+00', '1.80E+308'],
  [9.999e-310, '0.00E+00', '1.00E-309'],
  [-Number.MIN_VALUE, '0.00E+00;[Red](0.00E+00)', '(4.94E-324)'],
  [0, '0.00E+00', '0.00E+00'],
  [12345.678, '0.00E+00', '1.23E+04'],
  [0.00012, '0.0E+00', '1.2E-04'],
])('formats %s with %s without overflowing or underflowing', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps the smallest finite number intact in cell display and TEXT formulas', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, Number.MIN_VALUE, { literal: true });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.00E+00' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.00E+00")');
  expect(wb.getDisplay(id, 0, 0)).toBe('4.94E-324');
  expect(wb.getValue(id, 0, 1)).toBe('4.94E-324');
  expect(wb.getValue(id, 0, 0)).toBe(Number.MIN_VALUE);
});
