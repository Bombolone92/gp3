import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('finds the smallest value that is still at least the lookup value in descending data', () => {
  expect(calc('MATCH(4,{7,5,3,1},-1)')).toBe(2);
  expect(calc('MATCH(0,{7,5,3,1},-1)')).toBe(4);
  expect(calc('MATCH(5,{7,5,3,1},-1)')).toBe(2);
  expect(calc('MATCH(7,{7,5,3,1},-1)')).toBe(1);
  expect(calc('MATCH(8,{7,5,3,1},-1)')).toEqual({ error: '#N/A' });
  expect(calc('MATCH("bb",{"d","c","b","a"},-1)')).toBe(2);
  expect(calc('MATCH(4,A1:A4,-1)', { A1: '7', A2: '5', A3: '3', A4: '1' })).toBe(2);
});

it('leaves ascending and exact matching alone', () => {
  expect(calc('MATCH(4,{1,3,5,7},1)')).toBe(2);
  expect(calc('MATCH(8,{1,3,5,7},1)')).toBe(4);
  expect(calc('MATCH(0,{1,3,5,7},1)')).toEqual({ error: '#N/A' });
  expect(calc('MATCH(5,{1,3,5,7},0)')).toBe(3);
});
