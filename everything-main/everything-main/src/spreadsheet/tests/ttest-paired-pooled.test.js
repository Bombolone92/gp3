import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-ttest-paired-pooled.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native paired/pooled t-test: $expression', ({ formula, cells, expected }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('uses covariance before standard-error division, rather than variance of the paired differences', () => {
  expect(calc('T.TEST({0,3e-154,0},{3e-154,0,3e-154},2,1)')).toEqual({ error: '#DIV/0!' });
  expect(calc('T.TEST({0,4e-154,0},{4e-154,0,4e-154},2,1)')).toBeCloseTo(0.602640292880487, 13);
  expect(calc('T.TEST({0,0,3.5e-154},{0,0,0},2,1)')).toEqual({ error: '#DIV/0!' });
  expect(calc('T.TEST({0,0,0},{1,2,3},2,1)')).toBeCloseTo(0.0741799002274485, 14);
});

it('preserves native cancellation and the ordering of variance-minus-covariance contributions', () => {
  expect(calc('T.TEST({1,2,3},{1,2,3}+1e-8*{1,2,1},2,1)')).toEqual({ error: '#DIV/0!' });
  expect(calc('T.TEST({1,2,3},{1,2,3}+1e-6*{1,2,3},2,1)')).toBeCloseTo(0.0741710952975592, 13);
  const tiny = calc('T.TEST({1,2,3},{1,2,3}+1e-4*{1,1,1},2,1)');
  expect(tiny / 7.40148674863013e-9).toBeCloseTo(1, 11);
});

it('distinguishes overflow of sample moments from overflow of the combined standard error', () => {
  for (const type of [1, 2]) {
    expect(calc(`T.TEST(1e307*{9,9,9},1e307*{9,9,9},2,${type})`)).toEqual({ error: '#NUM!' });
    expect(calc(`T.TEST(1e154*{0,1,2,3},1e154*{2,1,3,0},2,${type})`)).toEqual({ error: '#NUM!' });
    expect(calc(`T.TEST(1.2e154*{0,1,0},1.2e154*{1,0,1},2,${type})`)).toEqual({ error: '#DIV/0!' });
  }
});

it('retains one-tailed probabilities, unequal pooled sample sizes and fractional Welch degrees of freedom', () => {
  const one = calc('T.TEST({1,2,3},{4,3},1,2)');
  expect(calc('T.TEST({1,2,3},{4,3},2,2)')).toBe(2 * one);
  expect(calc('TTEST({1,2,3},{4,3},2,1)')).toEqual({ error: '#N/A' });
  // The separate Welch calculation is unchanged by the paired/pooled fix.
  expect(calc('T.TEST({0,1},{1,0,2},2,3)')).toBeCloseTo(0.561150881240086, 13);
});
