import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-t-normalization.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native t normalization: $expression', ({ formula, expected, amplification }) => {
  const actual = calc(formula);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  // The probe amplifies cancellation around 1/2 or 1, including a few
  // final rounding bits. Preserve exact zeros without amplifying that noise.
  else expect(Math.abs(Number(actual) - expected)).toBeLessThan(Math.max(Math.abs(expected) * 1e-11, 4 * Number.EPSILON * amplification));
});

it('recognizes a rounded normalization endpoint before integrating the t density', () => {
  expect(calc('T.DIST(1e-7,1000,TRUE)')).toBe(0.5);
  expect(calc('T.DIST.RT(1e-7,1000)')).toBe(0.5);
  expect(calc('T.DIST.2T(1e-7,1000)')).toBe(1);
  expect(calc('TDIST(1e-7,1000,2)')).toBe(1);
  expect(calc('T.DIST.RT(1e-7,3)')).toBeLessThan(0.5);
  expect(calc('T.DIST(1e-7,1000,FALSE)')).toBeGreaterThan(0);
});

it('uses the rounded complement for one and two degrees while keeping other degrees precise', () => {
  for (const df of [1, 2]) {
    expect(calc(`T.DIST.2T(1e-7,${df})`)).toBe(calc(`BETA.DIST(${df}/(${df}+1e-7^2),${df}/2,0.5,TRUE)`));
  }
  expect(calc('T.DIST.2T(1e-7,3)')).not.toBe(calc('BETA.DIST(3/(3+1e-7^2),1.5,0.5,TRUE)'));
  expect(calc('T.DIST.RT(0.001,1000000)')).toBeCloseTo(0.499601057885825, 14);
});

it('uses the rounded beta argument for pooled tests at general degrees', () => {
  const actual = calc('T.TEST(SEQUENCE(10),SEQUENCE(10)+1e-7,2,2)');
  expect(actual).toBeCloseTo(1 - 703.5300431113 / 1e10, 15);
  expect(actual).not.toBe(calc('T.DIST.2T(1e-7*SQRT(6/11),18)'));
  expect(calc('TTEST(SEQUENCE(1000),SEQUENCE(1000)+1e-9,2,2)')).toBe(1);
});
