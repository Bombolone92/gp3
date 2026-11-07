import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// CELL("type") called a cell whose formula returns "" blank. CELL's "b" is for an empty cell alone;
// a text value, empty or not, is "l", as ISBLANK of the same cell is FALSE.
it.each([
  ['a formula returning ""', { A1: '=""' }, 'l'],
  ['a text function returning ""', { A1: '=LEFT("abc",0)' }, 'l'],
  ['text', { A1: 'text' }, 'l'],
  ['an empty cell', {}, 'b'],
  ['a number', { A1: '5' }, 'v'],
  ['a logical', { A1: 'TRUE' }, 'v'],
  ['an error', { A1: '=1/0' }, 'v'],
  ['a date', { A1: '=DATE(2024,1,1)' }, 'v'],
])('CELL("type") of %s', (_, cells, expected) => {
  expect(calc('CELL("type",A1)', cells)).toBe(expected);
  if (expected === 'l' && cells.A1?.startsWith('=')) expect(calc('ISBLANK(A1)', cells)).toBe(false);
});
