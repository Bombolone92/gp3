import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-beta-unit-shapes.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native unit-shape beta arithmetic: $expression', ({ formula, expected }) => {
  const actual = calc(formula);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('uses native subtraction order on either side of the unit-shape boundaries', () => {
  expect(calc('BETA.DIST(0.1,1,1e-16,TRUE)')).toBe(0);
  expect(calc('BETA.DIST(0.01,1,1e-16,TRUE)') / 1.00503358535014e-18).toBeCloseTo(1, 12);
  expect(calc('BETA.DIST(0.5,1,1e-16,TRUE)')).toBe(2 ** -53);
  expect(calc('BETA.DIST(0.9,1000,1,TRUE)') / 1.74787125172268e-46).toBeCloseTo(1, 12);
  expect(calc('BETA.DIST(0.900001,1000,1,TRUE)')).toBe(0);
});

it('keeps binomial and inverse calculations separate from worksheet beta cancellation', () => {
  expect(calc('BETA.DIST(0.93540567414755,10000,1,TRUE)')).toBe(0);
  expect(calc('BINOM.DIST(0,10000,1-0.93540567414755,TRUE)') / 9.9999999998015e-291).toBeCloseTo(1, 11);
  expect(calc('BETA.INV(1e-100,1000,1)')).toBeCloseTo(0.794328234724281, 14);
});

it('evaluates F.TEST through the right beta tail without reflecting its argument', () => {
  const sample = 'SQRT(1000*(1-0.9)/0.9*VAR.S(SEQUENCE(2001)))*{-1,0,1}';
  expect(calc(`F.TEST(${sample},SEQUENCE(2001))`) / 3.49574250344536e-46).toBeCloseTo(1, 11);
  expect(calc(`2*F.DIST.RT(VAR.S(${sample})/VAR.S(SEQUENCE(2001)),2,2000)`)).toBe(0);
});

it('uses finite closed forms for extreme shapes and preserves operation-specific underflow', () => {
  expect(calc('BETA.DIST(1e-154,1,1e300,TRUE)')).toBe(1);
  expect(calc('BETA.DIST(0.99,1e300,1,TRUE)')).toBe(0);
  expect(calc('BETA.DIST(1e-154,1,1e-154,TRUE)')).toBe(0);
  expect(calc('BETA.DIST(1e-154,2,1,TRUE)')).toBe(1e-308);
});
