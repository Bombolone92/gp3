import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// LOOKUP's approximate search stopped at the first error in the lookup vector, so the idiom for
// the last filled cell, LOOKUP(2,1/(A1:A9<>""),A1:A9), answered the first filled cell. The
// search passes over errors, as it does blanks and values of another type.
const FILLED = { A1: 'x', A2: 'y', A3: 'z', A10: 'w' };

it.each([
  ['LOOKUP(2,1/({1,0,1}<>0),{"a","b","c"})', 'c'],
  ['LOOKUP(2,1/(A1:A10<>""),A1:A10)', 'w', FILLED],
  ['LOOKUP(2,1/(A1:A5000<>""),ROW(A1:A5000))', 10, FILLED],
  ['LOOKUP(2,1/(A1:A5000<>""),A1:A5000)', 'w', FILLED],
  ['LOOKUP(9.99E+307,A1:A10)', 7, { A1: '1', A2: 'x', A4: '7', A6: 'q' }],
  ['LOOKUP("zzz",A1:A10)', 'a', { A1: 'b', A2: '5', A3: 'a' }],
  ['LOOKUP(2,1/({0,0}<>0),{"a","b"})', { error: '#N/A' }], // nothing but errors
  ['LOOKUP(2.5,{1,2,3},{"a","b","c"})', 'b'],
  ['LOOKUP(0,{1,2,3},{"a","b","c"})', { error: '#N/A' }],
  ['LOOKUP(A20,{1,2},{"a","b"})', { error: '#N/A' }], // an empty key is not a zero
  ['LOOKUP(1/0,{1,2},{"a","b"})', { error: '#DIV/0!' }],
])('%s answers %o', (formula, expected, cells = {}) => {
  expect(calc(formula, cells)).toEqual(expected);
});
