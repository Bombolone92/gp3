import { expect, it } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  ['>', [false, false, true]], ['>=', [false, true, true]],
  ['<', [true, false, false]], ['<=', [true, true, false]],
  ['=', [false, true, false]], ['<>', [true, false, true]],
])('selects a section using the %s comparison', (operator, matches) => {
  const code = `[${operator}10]"Match";"Other"`;
  for (const [i, value] of [9, 10, 11].entries()) expect(formatWithCode(value, code)).toBe(matches[i] ? 'Match' : 'Other');
});

it('uses the matching condition for both displayed text and color', () => {
  const code = '[Green][>100]0.0;[Yellow][<=-100]0.00;[Cyan]0.000;"Text: "@';
  expect(formatWithCode(150, code)).toBe('150.0');
  expect(formatWithCode(-150, code)).toBe('150.00');
  expect(formatWithCode(50, code)).toBe('50.000');
  expect(formatWithCode(-50, code)).toBe('-50.000');
  expect(formatWithCode(0, code)).toBe('0.000');
  expect(formatWithCode('hello', code)).toBe('Text: hello');
  expect(codeColor(150, code)).toBe('#00ff00');
  expect(codeColor(-150, code)).toBe('#ffff00');
  expect(codeColor(50, code)).toBe('#00ffff');
});

it.each([
  [-5, '[<0]0.0;0.00', '5.0'],
  [-5, '[<=0]0.0;0.00', '-5.0'],
  [-5, '[>100]0.0;0.00', '-5.00'],
  [-5, '[<-100]0.0;0.00', '5.00'],
  [-5, '[>100]0.0', '-5'],
  [5, '[>100]0.0', '5'],
  [5, '[>100]0.0;[<-100]0.00', '#####'],
  [5, '[>100]0.0;[<-100]0.00;', ''],
  [5, '[>0]0.0;[>1]0.00;0', '5.0'],
  [0.125, '[>=.1]0.0%;0.00', '12.5%'],
  [1000, '[>=1e3]0,"K";0', '1K'],
])('formats %s with conditional code %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps quoted and escaped comparisons literal', () => {
  expect(formatWithCode(5, '"[>100]"0;0.00')).toBe('[>100]5');
  expect(formatWithCode(5, '\\[\\>\\1\\0\\0\\]0;0.00')).toBe('[>100]5');
  expect(formatWithCode(5, '[>10]"[=5]"0;"fallback"')).toBe('fallback');
});

it('applies conditional codes to cell display and TEXT formulas', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '[=1]"one";"other"' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"[>10]0.0;0.00")');
  expect(wb.getDisplay(id, 0, 0)).toBe('other');
  expect(wb.getValue(id, 0, 1)).toBe('2.00');
});
