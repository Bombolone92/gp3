import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-welch-overflow.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native Welch overflow: $expression', ({ formula, expected, cells }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Math.abs(Number(actual) - expected)).toBeLessThan(Math.abs(expected) * 1e-11);
});

it('checks each overflowed square before summing the Welch denominator', () => {
  expect(calc('T.TEST(4e77*{0,1,0},{1,0,1},2,3)')).toEqual({error:'#NUM!'});
  expect(calc('T.TEST(4e77*{0,1,0},0*{1,0,1},2,3)')).toEqual({error:'#DIV/0!'});
  expect(calc('T.TEST(4e77*{0,1,0},4e77*{1,0,1},2,3)')).toEqual({error:'#DIV/0!'});
});

it('handles overflow in the numerator and in the sum of finite denominator terms separately', () => {
  // Both individual squares are finite; their sum overflows for these n=2 samples.
  expect(calc('T.TEST(2.197000422116e77*{0.5,1.5},2.197000422116e77*{-0.5,0.5},2,3)'))
    .toEqual({error:'#DIV/0!'});
  // Here the numerator square overflows but the denominator remains finite.
  expect(calc('T.TEST(2e77*{-1,0,1},2e77*{0,1,2},2,3)')).toEqual({error:'#NUM!'});
  expect(calc('T.TEST(2e77*{-1,0,1},2e77*{-1,0,1},2,3)')).toEqual({error:'#DIV/0!'});
});

it('tests zero degrees after flushing the squared statistic at the beta denominator', () => {
  expect(calc('T.TEST(1e78*{-1,0,1},5e-77*{0,1,2},2,3)')).toEqual({error:'#DIV/0!'});
  expect(calc('TTEST(1e-76*{0,1,2},1e78*{-1,0,1},1,3)')).toEqual({error:'#NUM!'});
});

it('keeps paired, pooled and ordinary Welch results independent of degree overflow', () => {
  for (const type of [1,2]) {
    const result=calc(`T.TEST(4e77*{0,1,0},4e77*{1,0,1},2,${type})`);
    expect(result).toBeCloseTo(calc(`T.TEST({0,1,0},{1,0,1},2,${type})`),14);
  }
  expect(calc('T.TEST({0,1,0},{1,0,1},2,3)')).toBeCloseTo(0.518518518518519,14);
});
