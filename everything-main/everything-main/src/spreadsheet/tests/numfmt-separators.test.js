import { expect, it } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  ['0_;', '5 ', '-5 '],
  ['0*;', '5', '-5'],
  ['0_";[Red](0)', '5 ', '(5)'],
  ['0*";[Red](0)', '5', '(5)'],
  ['0_;"x";[Red](0)', '5 x', '(5)'],
  ['0*;"x";[Red](0)', '5x', '(5)'],
  ['0\\;"x";[Red](0)', '5;x', '(5)'],
  ['0";x";[Red](0)', '5;x', '(5)'],
  ['0"_";[Red](0)', '5_', '(5)'],
  ['0"*";[Red](0)', '5*', '(5)'],
  ['0_);[Red](0)', '5 ', '(5)'],
])('keeps literal separator characters inside their section in %s', (code, positive, negative) => {
  expect(formatWithCode(5, code)).toBe(positive);
  expect(formatWithCode(-5, code)).toBe(negative);
  expect(formatWithCode('hello', code)).toBe('hello');
});

it('uses actual numeric and text section boundaries for colors and conditions', () => {
  const code = '0_;;[Red](0);0;[Blue]@';
  expect(formatWithCode(5, code)).toBe('5 ');
  expect(formatWithCode(-5, code)).toBe('(5)');
  expect(formatWithCode(0, code)).toBe('0');
  expect(formatWithCode('hello', code)).toBe('hello');
  expect(codeColor(5, code)).toBeNull();
  expect(codeColor(-5, code)).toBe('#ff0000');
  expect(codeColor('hello', code)).toBe('#0000ff');
  expect(codeColor(5, '0_";[Red](0)')).toBeNull();
  expect(formatWithCode(-5, '[Green][>0]0_;;[Red]0')).toBe('5');
  expect(codeColor(-5, '[Green][>0]0_;;[Red]0')).toBe('#ff0000');
});

it('keeps cell display and TEXT results consistent for padding semicolons', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '-5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0_;;[Red](0)' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0_;;[Red](0)")');
  expect(wb.getDisplay(id, 0, 0)).toBe('(5)');
  expect(wb.getValue(id, 0, 1)).toBe('(5)');
});
