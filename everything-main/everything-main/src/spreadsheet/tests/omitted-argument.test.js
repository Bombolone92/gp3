import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('returns 0 for an omitted IF or IFS branch that is chosen', () => {
  expect(calc('IF(A1>0,,5)', { A1: '3' })).toBe(0);
  expect(calc('IF(A1>0,5,)', { A1: '-3' })).toBe(0);
  expect(calc('IF(A1>0,5,)', { A1: '3' })).toBe(5);
  expect(calc('IF(TRUE,,)')).toBe(0);
  expect(calc('IFS(A1>0,,TRUE,5)', { A1: '3' })).toBe(0);
  expect(calc('IF(A1>0,)&"x"', { A1: '3' })).toBe('0x');
});

it('preserves a missing branch default and materializes blank references', () => {
  expect(calc('IF(FALSE,5)')).toBe(false);
  expect(calc('IF(TRUE,A1,5)')).toBe(0);
  expect(calc('SUM(IF(A1:A2>0,,1))', { A1: '1', A2: '-1' })).toBe(1);
});
