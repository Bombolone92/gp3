import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// XMATCH and XLOOKUP's next-larger and next-smaller modes let an error cell stand as the answer: an
// error had the rank of a number and compared as NaN, which counted as greater than the needle, and
// no later real candidate could displace it. The search now passes over errors, as it does text and
// booleans beside a numeric needle, so a lookup column carrying #N/A from upstream formulas still
// finds the right row.
it.each([
  ['XMATCH(7,{1,#N/A,5,10},1)', 4],
  ['XMATCH(7,{1,#N/A,5,10},-1)', 3],
  ['XMATCH(2,{1,#N/A,5,10},1)', 3],
  ['XMATCH(4,{10,#N/A,5,1},-1)', 4],
  ['XMATCH(4,{10,#N/A,5,1},1)', 3],
  ['XMATCH(7,{1,#N/A,5,10},1,-1)', 4], // searched last to first
  ['XMATCH(7,{1,#DIV/0!,5,#VALUE!},1)', { error: '#N/A' }], // nothing larger but errors
  ['XMATCH(7,{1,"x",5,10},1)', 4], // text and booleans were already passed over
  ['XMATCH(7,{1,TRUE,5,10},1)', 4],
  ['XLOOKUP(2,{1,#N/A,5,10},{"a","b","c","d"},,1)', 'c'],
  ['XLOOKUP(7,{1,#N/A,5,10},{"a","b","c","d"},,-1)', 'c'],
  ['XLOOKUP(2,{1,#N/A,5,10},{"a","b","c","d"},"none",1,-1)', 'c'],
  ['XMATCH(1/0,{1,2},1)', { error: '#DIV/0!' }], // an error needle is still the error
])('%s answers %o', (formula, expected) => {
  expect(calc(formula)).toEqual(expected);
});

it('finds the item in a column whose cells hold errors among the numbers', () => {
  const cells = { A1: '1', A2: '=NA()', A3: '5', A4: '10', B1: 'a', B2: 'b', B3: 'c', B4: 'd' };
  expect(calc('XMATCH(7,A1:A4,1)', cells)).toBe(4);
  expect(calc('XLOOKUP(2,A1:A4,B1:B4,,1)', cells)).toBe('c');
  expect(calc('XLOOKUP(7,A1:A4,B1:B4,,-1)', cells)).toBe('c');
});
