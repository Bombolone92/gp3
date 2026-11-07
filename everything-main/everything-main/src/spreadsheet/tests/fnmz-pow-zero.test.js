import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// POW(0,0) was 1 and POW(0,-1) #NUM! while 0^0 and POWER(0,0) are #NUM! and 0^-1 is #DIV/0!
// (6fda25a): POW is the ^ operator as a function and shares POWER's rule.
it.each([
  ['POW(0,0)', { error: '#NUM!' }],
  ['POW(0,-1)', { error: '#DIV/0!' }],
  ['POW(0,-0.5)', { error: '#DIV/0!' }],
  ['POWER(0,0)', { error: '#NUM!' }],
  ['0^0', { error: '#NUM!' }],
  ['0^-1', { error: '#DIV/0!' }],
  ['POW(2,10)', 1024],
  ['POW(0,2)', 0],
  ['POW(2,0)', 1],
  ['POW(2,"3")', 8],
  ['POW("x",2)', { error: '#VALUE!' }],
  ['POW(-8,1/3)', { error: '#NUM!' }],
  ['POW(10,400)', { error: '#NUM!' }],
])('%s is %o', (formula, expected) => {
  expect(calc(formula)).toEqual(expected);
});
