import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-trimmean-arithmetic.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native trimmed-mean arithmetic: $expression', ({ formula, expected, cells }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('sums qualifying observations in original order before subtracting excess boundary duplicates', () => {
  expect(calc('TRIMMEAN(9e307*{1,1,-1},0)')).toEqual({ error: '#NUM!' });
  expect(calc('TRIMMEAN(9e307*{1,-1,1},0)') / 3e307).toBeCloseTo(1, 13);
  expect(calc('TRIMMEAN(9e307*{1,-1,1},0.8)')).toEqual({ error: '#NUM!' });
  expect(calc('TRIMMEAN(9e307*{1,1,0,-1,-1},0.8)')).toBe(0);
});

it('subtracts duplicate boundaries individually instead of multiplying their counts', () => {
  const expected = 2.77555756156289e-17;
  expect(calc('1*(TRIMMEAN(0.1*SEQUENCE(5)^0,0.9)-0.1)') / expected).toBeCloseTo(1, 13);
  expect(calc('1*(TRIMMEAN(1e16+{2,2,0,-2,2,-4,2,-1,4},0.8)-1e16)')).toBe(2);
});

it('ignores a single referenced text or boolean observation while retaining direct coercion', () => {
  for (const value of ['TRUE', 'text', "'2"]) {
    expect(calc('TRIMMEAN(A1,0)', { A1: value })).toEqual({ error: '#NUM!' });
    expect(calc('TRIMMEAN(A1:A3,0)', { A1: value, A2: '4', A3: '6' })).toBe(5);
  }
  expect(calc('TRIMMEAN(TRUE,0)')).toBe(1);
  expect(calc('TRIMMEAN("2",0)')).toBe(2);
  expect(calc('SUM(TRIMMEAN({1,2,3,4,5},{0,0.4}))')).toBe(6);
});
