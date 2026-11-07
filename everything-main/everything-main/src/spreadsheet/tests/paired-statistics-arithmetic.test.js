import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-paired-statistics.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native paired statistics: $expression', ({ formula, expected }) => {
  const actual = calc(formula);
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('flushes covariance products before summing, then flushes the final division', () => {
  expect(calc('COVARIANCE.S({1e-154,-1e-154,1e-154,-1e-154},{1e-154,-1e-154,1e-154,-1e-154})')).toBe(0);
  expect(calc('COVARIANCE.S({0,0,3e-154},{0,0,3e-154})')).toBe(0);
  expect(calc('COVARIANCE.S({0,4e-154,0},{4e-154,0,4e-154})') * 1e307).toBeCloseTo(-0.355555555555556, 13);
});

it('distinguishes zero spread from normalized moments that underflow, including RSQ sample normalization', () => {
  for (const fn of ['CORREL', 'PEARSON', 'RSQ']) {
    expect(calc(`${fn}({0,2e-154,0},{2e-154,0,2e-154})`)).toEqual({ error: '#DIV/0!' });
    expect(calc(`${fn}({0,3e-154,0},{3e-154,0,3e-154})`)).toEqual({ error: '#NUM!' });
  }
  expect(calc('CORREL({0,0,3.2e-154},{0,0,3.2e-154})')).toEqual({ error: '#NUM!' });
  expect(calc('RSQ({0,0,3.2e-154},{0,0,3.2e-154})')).toBeCloseTo(1, 13);
});

it('keeps correlation scale-invariant while squared sums remain representable', () => {
  for (const scale of ['1e-100', '1', '1e100', '1e154']) {
    expect(calc(`CORREL({0,${scale},0},{${scale},0,${scale}})`)).toBeCloseTo(-1, 13);
    expect(calc(`RSQ({0,${scale},0},{${scale},0,${scale}})`)).toBeCloseTo(1, 13);
  }
});

it('applies underflow to regression coefficients and STEYX intermediate products', () => {
  expect(calc('SLOPE({0,1e-154,0},{0,1e154,0})')).toBe(0);
  expect(calc('INTERCEPT({0,1e-154,0},{0,1e154,0})') / 1e-154).toBeCloseTo(1 / 3, 13);
  expect(calc('FORECAST.LINEAR(2,{0,1e-154,0},{0,1e154,0})') / 1e-154).toBeCloseTo(1 / 3, 13);
  expect(calc('STEYX({0,4e-154,0},{4e-154,0,4e-154})') / 1e-154).toBeCloseTo(8 / 3, 12);
});
