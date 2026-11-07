import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-beta-quadrature-tails.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native beta integration tails: $expression', ({ formula, expected }) => {
  const actual = calc(formula);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  // Near underflow, tiny argument rounding differences are amplified by
  // large shape parameters, especially in the F-to-beta transformation.
  else expect(Math.abs(Number(actual) / expected - 1)).toBeLessThan(1e-10);
});

it('integrates skewed tails beyond forty standard deviations on either side', () => {
  const x = 0.99734834289652, expected = 6.0389869744298e-298;
  expect(calc(`BETA.DIST(${x},1000000,1000,TRUE)`) / expected).toBeCloseTo(1, 11);
  expect(calc(`F.DIST.RT(1000*(1-${x})/${x},2000,2000000)`) / expected).toBeCloseTo(1, 11);
  expect(calc(`F.DIST(${x}/(1000*(1-${x})),2000000,2000,TRUE)`) / expected).toBeCloseTo(1, 11);
});

it('flushes subnormal integrated tails while preserving nearby normal probabilities', () => {
  expect(calc('BETA.DIST(0.48121867258419,500000,500000,TRUE)')).toBe(0);
  expect(calc('BETA.DIST(0.99731533777746,1000000,1000,TRUE)') / 5.9208972654037e-307).toBeCloseTo(1, 11);
  // The independent unit-shape power path still preserves subnormals.
  expect(calc('BETA.DIST(1e-154,2,1,TRUE)')).toBe(1e-308);
});
