import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Numeric text was read as a logical value: IF("1",1,2) gave 1 and IF("0",1,2) gave 2, where only
// the words TRUE and FALSE count as text for a logical value, and any other text answers
// #VALUE!.
const E = { error: '#VALUE!' };

it.each([
  ['IF("1",1,2)', E],
  ['IF("0",1,2)', E],
  ['IF("1.5",1,2)', E],
  ['IF("$5",1,2)', E],
  ['IF("abc",1,2)', E],
  ['AND("1")', E],
  ['OR("0")', E],
  ['NOT("1")', E],
  ['IF(A1,1,2)', E, { A1: '="1"' }],
  ['IF("TRUE",1,2)', 1],
  ['IF(" false ",1,2)', 2],
  ['IF("true",1,2)', 1],
  ['NOT("FALSE")', true],
  ['AND("TRUE",1)', true],
  ['OR("FALSE",0)', false],
  ['IF(1,1,2)', 1],
  ['IF(0,1,2)', 2],
  ['IF(A1,1,2)', 2],
  ['IF(A1,1,2)', 1, { A1: '1' }],
  ['AND(A1:A2)', true, { A1: '1', A2: '="1"' }], // a text cell in a range is passed over, as before
])('%s answers %o', (formula, expected, cells = {}) => {
  expect(calc(formula, cells)).toEqual(expected);
});
