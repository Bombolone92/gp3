import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// An argument documented as a number (a match type, sort order, day-count basis, weekday
// type, payment type, TAKE's count) is read from numeric text, "1" as 1, while an argument
// documented as a logical value (range_lookup, cumulative, by_col, ignore_empty, no_switch, a1)
// takes numbers and the words TRUE and FALSE but answers #VALUE! for other text, "1" included.
// Now that only those words coerce to a logical, this pins which argument is which.
const T = { A1: '3', A2: '1', A3: '2', B1: 'c', B2: 'a', B3: 'b', C1: '2024-03-15', C2: '2024-09-15' };
const E = { error: '#VALUE!' };

it.each([
  ['INDEX(SORT(A1:A3,1,"-1"),1)', 3],
  ['INDEX(SORT(A1:A3,"1",1),1)', 1],
  ['INDEX(SORTBY(A1:A3,B1:B3,"-1"),1)', 3],
  ['MATCH(2,A2:A3,"1")', 2],
  ['MATCH(2,A1:A3,"0")', 3],
  ['XMATCH(2,A1:A3,"0","1")', 3],
  ['VLOOKUP(1,A1:B3,"2",FALSE)', 'a'],
  ['RANK("1",A1:A3,"1")', 1],
  ['WEEKDAY(C1,"2")', 5],
  ['WEEKNUM(C1,"2")', 11],
  ['ROUND(YEARFRAC(C1,C2,"1"),6)', 0.502732],
  ['TEXTBEFORE("a-b-c","-","2")', 'a-b'],
  ['TEXTAFTER("a-b-c","-","1","1")', 'b-c'],
  ['SUBTOTAL("9",A1:A3)', 6],
  ['AGGREGATE("9","6",A1:A3)', 6],
  ['ROWS(TOCOL({1,2;3,4},"1"))', 4],
  ['ROWS(TAKE(A1:A3,"2"))', 2],
  ['ROWS(DROP(A1:A3,"1"))', 2],
  ['COLUMNS(WRAPROWS({1,2,3},"2"))', 2],
  ['ROWS(SEQUENCE("2"))', 2],
  ['ROUND(PMT(0.05/12,"12",-1000,0,"1"),2)', 85.25],
  ['ROUND(NPER(0.05,-100,1000,0,"1"),4)', 13.2532],
  ['DDB(1000,100,5,"1")', 400],
  ['VDB(1000,100,5,0,"1")', 400],
])('%s reads numeric text as the number and answers %s', (formula, expected) => {
  expect(calc(formula, T)).toBe(expected);
});

it.each([
  'VLOOKUP(1,A1:B3,2,"1")',
  'HLOOKUP(3,A1:B3,2,"1")',
  'UNIQUE(A1:A3,"1")',
  'UNIQUE(A1:A3,FALSE,"1")',
  'INDIRECT("A1","1")',
  'ADDRESS(1,1,1,"1")',
  'FIXED(1234.5,1,"1")',
  'DAYS360(C1,C2,"1")',
  'RANDARRAY(2,1,1,9,"1")',
  'TEXTJOIN(",","1",A1:A3)',
  'TOCOL({1,2;3,4},0,"1")',
  'TEXTSPLIT("a,,b",",",,"1")',
  'NORM.DIST(1,0,1,"1")',
  'BINOM.DIST(1,2,0.5,"1")',
  'VDB(1000,100,5,0,1,2,"1")',
  'FILTER(A1:A3,{"1";"0";"1"})',
  'GROUPBY(B1:B3,A1:A3,SUM,0,0,0,{"1";"1";"0"})',
  'IF("1",1,2)',
  'NOT("1")',
])('%s takes the text "1" for no logical value', (formula) => {
  expect(calc(formula, T)).toEqual(E);
});

it('takes numbers and the words TRUE and FALSE for a logical argument', () => {
  expect(calc('VLOOKUP(1,A1:B3,2,0)', T)).toBe('a');
  expect(calc('VLOOKUP(1,A1:B3,2,"FALSE")', T)).toBe('a');
  expect(calc('ROUND(NORM.DIST(1,0,1,1),4)')).toBe(0.8413);
  expect(calc('ROUND(NORM.DIST(1,0,1,"true"),4)')).toBe(0.8413);
  expect(calc('ROWS(UNIQUE(A1:A3,0))', T)).toBe(3);
  expect(calc('TEXTJOIN(",",1,A1:A3)', T)).toBe('3,1,2');
});
