import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-ttest-sample-moments.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native t-test sample moments: $expression', ({ formula, expected, cells }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Math.abs(Number(actual) - expected)).toBeLessThan(Math.abs(expected) * 1e-11);
});

it('rejects overflowing Welch sample sums before a zero variance can mask the error', () => {
  expect(calc('T.TEST(9e307*{1,1},{0,0},2,3)')).toEqual({ error: '#NUM!' });
  expect(calc('TTEST({0,0},9e307*{1,1},1,3)')).toEqual({ error: '#NUM!' });
  expect(calc('T.TEST(8e307*{1,1},{0,0},2,3)')).toEqual({ error: '#DIV/0!' });
});

it('checks sample moment overflow before singleton counts but after empty samples', () => {
  for (const type of [2, 3]) {
    for (const sample of ['9e307*{1,1}', '1e154*{1,-1,0}']) {
      expect(calc(`T.TEST(${sample},A1,2,${type})`, { A1: '0' })).toEqual({ error: '#NUM!' });
      expect(calc(`TTEST(A1,${sample},2,${type})`, { A1: '0' })).toEqual({ error: '#NUM!' });
      expect(calc(`T.TEST(${sample},A1,2,${type})`)).toEqual({ error: '#DIV/0!' });
    }
    expect(calc(`T.TEST({1,2,3},A1,2,${type})`, { A1: '0' })).toEqual({ error: '#DIV/0!' });
  }
});

it('preserves ordinary probabilities and existing denominator-underflow semantics', () => {
  expect(calc('T.TEST({0,1},{1,0,2},2,3)')).toBeCloseTo(0.561150881240086, 13);
  expect(calc('T.TEST(4e-77*{0,1,0},4e-77*{1,0,1},2,3)')).toEqual({ error: '#DIV/0!' });
  expect(calc('T.TEST(6e-77*{0,1,0},6e-77*{1,0,1},2,3)')).toBeCloseTo(0.518518518518519, 14);
});
