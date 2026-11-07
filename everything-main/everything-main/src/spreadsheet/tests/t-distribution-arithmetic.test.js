import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-t-distribution-arithmetic.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native t-distribution arithmetic: $expression', ({ formula, cells, expected }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('scales the two-sided probability before flushing its one-sided half', () => {
  expect(calc('T.DIST.RT(6e153,2)')).toBe(0);
  expect(calc('TDIST(6e153,2,1)')).toBe(0);
  expect(calc('T.DIST.2T(6e153,2)') / 1e-308).toBeCloseTo(25 / 9, 12);
  expect(calc('TDIST(6e153,2,2)') / 1e-308).toBeCloseTo(25 / 9, 12);
  expect(calc('T.DIST(-6e153,2,TRUE)')).toBe(0);
  expect(calc('T.DIST.RT(-6e153,2)')).toBe(1);
});

it('flushes the normalized beta argument before evaluating a normal-sized t tail', () => {
  expect(calc('T.DIST.RT(8e153,1)')).toBe(0);
  expect(calc('T.DIST.2T(8e153,1)')).toBe(0);
  expect(calc('T.DIST.RT(6e153,1)')).toBeGreaterThan(1e-155);
});

it('retains the distinct Cauchy reciprocal and two-degree power density paths', () => {
  expect(calc('T.DIST(7e153,1,FALSE)')).toBe(0);
  expect(calc('T.DIST(8e153,1,FALSE)')).toEqual({ error: '#DIV/0!' });
  expect(calc('T.DIST(5e102,2,FALSE)') / 1e-308).toBeCloseTo(0.8, 12);
  expect(calc('T.DIST(0,1,FALSE)')).toBeCloseTo(1 / Math.PI, 14);
  expect(calc('T.DIST(0,2,FALSE)')).toBeCloseTo(1 / (2 * Math.sqrt(2)), 14);
});

it('reports squared-statistic overflow for both signs and cumulative/density paths', () => {
  for (const f of ['T.DIST(1.5e154,2,TRUE)', 'T.DIST(-1.5e154,1,FALSE)',
    'T.DIST.RT(-1.5e154,3)', 'T.DIST.2T(1.5e154,3)', 'TDIST(1.5e154,2,1)']) {
    expect(calc(f)).toEqual({ error: '#NUM!' });
  }
});

it('keeps a normal two-sided pooled T-test answer when its one-sided answer vanishes', () => {
  expect(calc('T.TEST({0,4e-154},{1,1},1,2)')).toBe(0);
  expect(calc('T.TEST({0,4e-154},{1,1},2,2)') / 1e-308).toBeCloseTo(4, 12);
});
