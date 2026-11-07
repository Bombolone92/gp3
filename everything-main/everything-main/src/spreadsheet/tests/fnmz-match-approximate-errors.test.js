import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Approximate MATCH, VLOOKUP and HLOOKUP, and the binary searches of XMATCH and XLOOKUP, stopped at
// an error cell: an error had the rank of a number and compared as NaN, greater than everything, so
// the ascending search ended there as at a value above the needle, the descending one kept the
// error's own position, and the binary search ranked it above the needle. The search should pass over
// cells of another type, errors included, which the last-filled-row idiom MATCH(2,1/(A:A<>""))
// depends on. LOOKUP (16d9fa4) and the linear XMATCH search (4f1ad72) already did.
it.each([
  ['MATCH(7,{1,#N/A,5,10},1)', 3],
  ['MATCH(7,{1,#N/A,5,10})', 3], // the default match type is 1
  ['MATCH(10,{1,#N/A,5,10},1)', 4],
  ['MATCH(5,{10,#N/A,3,1},-1)', 1],
  ['MATCH(7,{#N/A,#DIV/0!},1)', { error: '#N/A' }],
  ['VLOOKUP(7,{1,"a";#N/A,"b";5,"c";10,"d"},2)', 'c'],
  ['VLOOKUP(7,{1,"a";#N/A,"b";5,"c";10,"d"},2,TRUE)', 'c'],
  ['HLOOKUP(7,{1,#N/A,5,10;"a","b","c","d"},2)', 'c'],
  ['XMATCH(7,{1,#N/A,5,10},1,2)', 4],
  ['XMATCH(7,{1,#N/A,5,10},-1,2)', 3],
  ['XMATCH(5,{1,#N/A,5,10},0,2)', 3],
  ['XMATCH(7,{10,#N/A,5,1},-1,-2)', 3],
  ['XMATCH(7,{10,#N/A,5,1},1,-2)', 1],
  ['XMATCH(7,{#N/A,#N/A,#N/A},1,2)', { error: '#N/A' }],
  ['XMATCH(7,{1,#N/A,#N/A,#N/A,5,#N/A,10,#N/A},1,2)', 7],
  ['XLOOKUP(7,{1,#N/A,5,10},{"a","b","c","d"},,-1,2)', 'c'],
  ['MATCH(7,{1,"x",5,10},1)', 3], // text and booleans were already passed over
  ['MATCH(7,{1,TRUE,5,10},1)', 3],
])('%s answers %o', (formula, expected) => {
  expect(calc(formula)).toEqual(expected);
});

it('finds the last filled row of a column with gaps through MATCH(2,1/(range<>""))', () => {
  const cells = { F1: 'a', F2: 'b', F4: 'd', F5: 'e' };
  expect(calc('MATCH(2,1/(F1:F6<>""))', cells)).toBe(5);
  expect(calc('INDEX(F1:F6,MATCH(2,1/(F1:F6<>"")))', cells)).toBe('e');
  expect(calc('VLOOKUP(2,IF({1,0},1/(F1:F6<>""),F1:F6),2)', cells)).toBe('e');
});

it('passes over error cells of a sheet in a binary XLOOKUP', () => {
  const cells = { A1: '1', A2: '=NA()', A3: '5', A4: '10', B1: 'a', B2: 'b', B3: 'c', B4: 'd' };
  expect(calc('XLOOKUP(7,A1:A4,B1:B4,,1,2)', cells)).toBe('d');
  expect(calc('XLOOKUP(7,A1:A4,B1:B4,,-1,2)', cells)).toBe('c');
  expect(calc('XLOOKUP(5,A1:A4,B1:B4,,0,2)', cells)).toBe('c');
});
