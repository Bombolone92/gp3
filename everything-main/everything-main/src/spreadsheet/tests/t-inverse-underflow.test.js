import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import oracle from './fixtures/reference-t-inverse-underflow.json';

it.each(oracle.cases)('resolves inverse t tails or reports their underflow: $expression', ({ expression, expected }) => {
  const actual = calc(expression);
  if (typeof expected === 'number') expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-11);
  else expect(actual).toEqual(expected);
});

it('distinguishes the general beta target from the Cauchy angle and two-tail scaling', () => {
  // These probabilities straddle half the smallest normal binary64 value.
  // EXP preserves a subnormal value; ordinary division would flush it first.
  const above = 'EXP(-709.0895657128)', below = 'EXP(-709.0895657129)';
  expect(calc(`T.INV(${above},2)`)).toBeLessThan(-6e153);
  expect(calc(`T.INV(${below},2)`)).toEqual({ error: '#NUM!' });
  expect(calc(`T.INV(${below},1)`)).toBeLessThan(-1e307);
  expect(calc(`T.INV.2T(${above},2)`)).toEqual({ error: '#NUM!' });
  expect(calc(`T.INV(${below},1.9)`)).toBe(calc(`T.INV(${below},1)`));
  expect(calc(`T.INV(${below},2.9)`)).toEqual({ error: '#NUM!' });
});
