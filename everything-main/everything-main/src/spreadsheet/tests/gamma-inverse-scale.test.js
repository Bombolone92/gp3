import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import oracle from './fixtures/reference-gamma-inverse-scale.json';

const relative = (actual, expected) => expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-10);
it.each(oracle.cases)('preserves gamma quantile scaling and tails: $expression', ({ expression, expected }) => {
  const actual = calc(expression);
  if (typeof expected !== 'number' || expected === 0) expect(actual).toEqual(expected);
  else relative(actual, expected);
});

it('flushes unit-quantile and final-product underflow without flushing the scale argument', () => {
  expect(calc('GAMMA.INV(1e-154,0.5,1e100)')).toBe(0);
  expect(calc('CHISQ.INV(1.5e-154,1)')).toBe(0);
  relative(calc('CHISQ.INV(2e-154,1)'), 2 * Math.PI * 1e-308);
  expect(calc('GAMMA.INV(1e-153,0.5,0.001)')).toBe(0);
  relative(calc('GAMMA.INV(0.99,1,EXP(-709))'), -Math.log(0.01) * Math.exp(-709));
  expect(calc('GAMMA.INV(0.99,1,EXP(-720))')).toBe(0);
  // Beta has different native scaling semantics; do not clamp the shared solver.
  expect(calc('BETA.INV(1e-154,0.5,1,0,1e100)')).toBeGreaterThan(1e-209);
});

it('searches independently of scale and avoids cancellation in either tail', () => {
  const p = 1 - 1e-14;
  relative(calc('GAMMA.INV(1-1e-14,1,1e100)'), -Math.log1p(-p) * 1e100);
  relative(calc('CHISQ.INV.RT(1-1e-14,2)'), -2 * Math.log(p));
  relative(calc('GAMMA.INV(1e-300,100,1e307)'), 3.8006988916942e305);
  expect(calc('GAMMA.INV(0.99,100,1e307)')).toEqual({ error: '#NUM!' });
});
