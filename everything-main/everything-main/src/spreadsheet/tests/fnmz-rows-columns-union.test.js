import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// ROWS and COLUMNS of a union counted the areas stacked into one column, so ROWS((A1:A3,B1:B5)) was
// 8 and COLUMNS((A1:C3,B1:B5)) 1. They now count the first area, as INDEX reads a union without area_num.
it.each([
  ['ROWS((A1:A3,B1:B5))', 3],
  ['COLUMNS((A1:C3,B1:B5))', 3],
  ['ROWS((B1:B5,A1:A3))', 5],
  ['COLUMNS((B1:B5,A1:C3))', 1],
  ['ROWS((A:A,B1:B5))', 1048576],
  ['COLUMNS((1:1,B1:B5))', 16384],
  ['ROWS(A1:A3)', 3],
  ['COLUMNS(A1:C3)', 3],
  ['ROWS({1;2;3})', 3],
  ['COLUMNS({1,2;3,4})', 2],
])('%s is %o', (formula, expected) => {
  expect(calc(formula)).toBe(expected);
});
