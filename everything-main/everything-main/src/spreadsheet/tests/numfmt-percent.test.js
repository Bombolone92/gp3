import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

// Percent formats scale decimal percentages but retain scientific magnitude.
it.each([
  [0.125, '0.00%%', '1250.00%%'],
  [-0.125, '0.00%%', '-1250.00%%'],
  [0.125, '0.0%%%', '125000.0%%%'],
  [0.125, '#,##0.00%%', '1,250.00%%'],
  [0.125, '0.00,%%', '1.25%%'],
  [-0.125, '0.00%%;[Red](0.00%%)', '(1250.00%%)'],
  [0.125, '0.00E+00%%', '1.25E-01%%'],
  [-0.125, '0.00E+00%%%', '-1.25E-01%%%'],
  [Number.MIN_VALUE, '0.00E+00%%', '4.94E-324%%'],
  [Number.MAX_VALUE, '0.00E+00%%', '1.80E+308%%'],
  [0.125, '0.00%"%"', '12.50%%'],
  [0.125, '0.00%\\%', '12.50%%'],
  [0.125, '0.00%%"%"', '1250.00%%%'],
  [0.125, '0.00%_%', '12.50% '],
  [0.125, '0.00%*%', '12.50%'],
  [0.125, '0.00"%%"', '0.13%%'],
  [0.125, '0.00E+00%"%"', '1.25E-01%%'],
])('formats %s with decimal or scientific percent semantics in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps zero finite even when a format contains many percent placeholders', () => {
  const suffix = '%'.repeat(200);
  expect(formatWithCode(0, `0.00${suffix}`)).toBe(`0.00${suffix}`);
  expect(formatWithCode(0, `0.00E+00${suffix}`)).toBe(`0.00E+00${suffix}`);
});

it('scales tiny numbers even when the combined percentage multiplier exceeds the numeric range', () => {
  const suffix = '%'.repeat(155);
  expect(formatWithCode(1e-320, `0.000000000000${suffix}`)).toBe(`0.000000000100${suffix}`);
});

it('applies repeated percentages consistently to cell display and TEXT without changing values', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0.125');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.00%%' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.00%%")');
  expect(wb.getDisplay(id, 0, 0)).toBe('1250.00%%');
  expect(wb.getValue(id, 0, 1)).toBe('1250.00%%');
  expect(wb.getValue(id, 0, 0)).toBe(0.125);
});
