import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-welch-underflow.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native Welch underflow: $expression', ({ formula, expected, cells }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Math.abs(Number(actual) - expected)).toBeLessThan(Math.abs(expected) * 1e-11);
});

it('flushes each divided squared-variance contribution before adding the Welch denominator', () => {
  // Each contribution is subnormal, although their mathematical sum is normal.
  expect(calc('T.TEST(4e-77*{0,1,0},4e-77*{1,0,1},2,3)')).toEqual({ error: '#DIV/0!' });
  expect(calc('TTEST(4e-77*{1,0,1},4e-77*{0,1,0},1,3)')).toEqual({ error: '#DIV/0!' });
  expect(calc('T.TEST(6e-77*{0,1,0},6e-77*{1,0,1},2,3)')).toBeCloseTo(0.518518518518519, 14);
});

it('retains a normal contribution when only the other sample contribution underflows', () => {
  expect(calc('T.TEST(2.7713646299853e-77*SEQUENCE(2),(2.7713646299853e-77*0.5)*SEQUENCE(3),2,3)'))
    .toBeCloseTo(0.487410756270082, 14);
  expect(calc('TTEST((2.7713646299853e-77*0.5)*SEQUENCE(3),2.7713646299853e-77*SEQUENCE(2),1,3)'))
    .toBeCloseTo(0.243705378135041, 14);
});

it('keeps pooled tests independent of the Welch denominator and preserves ordinary Welch results', () => {
  for (const scale of ['1e-100', '4e-77', '6e-77', '1']) {
    expect(calc(`T.TEST(${scale}*{0,1,0},${scale}*{1,0,1},2,2)`)).toBeCloseTo(0.518518518518519, 14);
  }
  expect(calc('T.TEST({0,1,0},{1,0,1},2,3)')).toBeCloseTo(0.518518518518519, 14);
});
