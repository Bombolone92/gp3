import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  // Numerators pad on the left, denominators on the right.
  [0.333, '# ??/??', '  1/3 '],
  [0.5, '??/??', ' 1/2 '],
  [2.75, '# ??/??', '2  3/4 '],
  [2.75, '??/??', '11/4 '],
  [1.25, '# ??/16', '1  4/16'],
  [0.0625, '# ???/???', '   1/16 '],
  // A missing whole part keeps the space that separates it from the fraction.
  [0.5, '# ?/?', ' 1/2'],
  [0.75, '? ?/?', '  3/4'],
  [-0.5, '# ?/?', '- 1/2'],
  [0.75, '0 ?/?', '0 3/4'],
  // A whole number blanks its fraction and slash to the same width.
  [2, '# ?/?', '2    '],
  [-2, '# ?/?', '-2    '],
  [0, '# ?/?', '0    '],
  [1.999, '# ??/??', '2      '],
  [2, '# ?/8', '2    '],
  [2, '# ?/?" kg"', '2     kg'],
  [2.75, '?? ??/??', ' 2  3/4 '],
  [2, '?? ??/??', ' 2      '],
  // Placeholders other than ? add no padding.
  [2.75, '# ?/?', '2 3/4'],
  [2, '# #/#', '2'],
  [0.5, '#/#', '1/2'],
])('pads the fraction of %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('lines up a column of fractions on the slash', () => {
  const texts = [0.333, 2.75, 12.5, 0.0625].map((v) => formatWithCode(v, '# ??/??'));
  expect(new Set(texts.map((t) => t.length - t.indexOf('/'))).size).toBe(1);
  expect(texts.map((t) => t.trim())).toEqual(['1/3', '2  3/4', '12  1/2', '1/16']);
});

it('pads in cell display and TEXT alike', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2');
  wb.setInput(id, 1, 0, '0.5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { fmt: 'custom', code: '# ?/?' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"# ?/?")');
  wb.setInput(id, 1, 1, '=TEXT(A2,"# ?/?")');
  expect(wb.getDisplay(id, 0, 0)).toBe('2    ');
  expect(wb.getValue(id, 0, 1)).toBe('2    ');
  expect(wb.getDisplay(id, 1, 0)).toBe(' 1/2');
  expect(wb.getValue(id, 1, 1)).toBe(' 1/2');
  expect(wb.getValue(id, 0, 0)).toBe(2);
});
