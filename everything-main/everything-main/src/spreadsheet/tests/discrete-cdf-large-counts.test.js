import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The cumulative binomial, Poisson, negative binomial and hypergeometric
// distributions added their probabilities one count at a time, so a formula
// with a count of a billion ran for minutes and froze the app when its file
// opened. They now go through the incomplete beta and gamma functions (the
// hypergeometric sums only the terms that matter, out from its mode), and the
// probability masses themselves are conditioned so a billion trials keep their
// digits. References: 30- to 40-digit mpmath evaluations; the n = 1E9 binomial
// mass is 2 (P - 1/2) of the symmetric CDF.
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};
const quick = (formula, ms = 500) => {
  const t0 = performance.now();
  const v = calc(formula);
  expect(performance.now() - t0).toBeLessThan(ms);
  return v;
};

describe('binomial', () => {
  it('BINOM.DIST answers at once and accurately for a billion trials', () => {
    expect(quick('BINOM.DIST(500000000,1000000000,0.5,TRUE)')).toBeCloseTo(0.50001261566260694689, 13);
    expect(calc('BINOM.DIST(600,1200,0.5,TRUE)')).toBeCloseTo(0.51151407263430134132, 13);
    // References at the exact double p: 1 - p as a double lands 3E-17 away, where the density is in the thousands.
    expect(calc('BINOM.DIST(1000,100000,0.01,TRUE)')).toBeCloseTo(0.50840947335143268454, 13);
    expect(calc('BINOM.DIST(9000000,10000000,0.9,TRUE)')).toBeCloseTo(0.50015419143038967535, 13);
    expect(calc('BINOM.DIST(3,1000000000,0.000000001,TRUE)')).toBeCloseTo(0.98101184318515942731, 13);
    expect(calc('BINOM.DIST(499000000,1000000000,0.5,TRUE)')).toBe(0);
    expect(calc('BINOM.DIST(1000000000,1000000000,0.5,TRUE)')).toBe(1);
    relative('BINOM.DIST(500000000,1000000000,0.5,FALSE)', 2.523132521389378e-5, 1e-12);
    relative('BINOM.DIST(3,1000000000,0.000000001,FALSE)', 0.061313240164583767, 1e-12); // C(n,3) p³ (1-p)^(n-3), just under the Poisson e^-1 / 6
  });

  it('BINOM.DIST.RANGE uses the tails for a wide range and the masses for a narrow one', () => {
    expect(quick('BINOM.DIST.RANGE(1000000000,0.5,0,500000000)')).toBeCloseTo(0.50001261566260694689, 13);
    expect(quick('BINOM.DIST.RANGE(1000000000,0.5,500000000,1000000000)')).toBeCloseTo(0.50001261566260694689, 13);
    expect(quick('BINOM.DIST.RANGE(1000000000,0.5,400000000,600000000)')).toBe(1);
    relative('BINOM.DIST.RANGE(1000000000,0.5,500000000)', 2.523132521389378e-5, 1e-12);
    expect(calc('BINOM.DIST.RANGE(60,0.75,45,50)')).toBeCloseTo(0.523630, 6);
    expect(calc('BINOM.DIST.RANGE(5000,0.5,2400,2600)')).toBeCloseTo(0.99552956, 6);
  });

  it('BINOM.INV halves the count range instead of walking it', () => {
    expect(quick('BINOM.INV(1000000000,0.5,0.5)')).toBe(500000000);
    expect(quick('BINOM.INV(1000000000,0.000000001,0.99)')).toBe(4); // P(X ≤ 3) = 0.981, P(X ≤ 4) = 0.996
    expect(calc('BINOM.INV(5000,0.5,0.5)')).toBe(2500);
    expect(calc('BINOM.INV(2000,0.3,0.9)')).toBe(626);
    expect(calc('CRITBINOM(1100,0.5,0.5)')).toBe(550);
    expect(calc('BINOM.INV(10,0.5,0.5)')).toBe(5);
    expect(calc('BINOM.INV(6,0.5,0.75)')).toBe(4);
    expect(calc('BINOM.INV(4,0.5,0.0625)')).toBe(0); // P(X ≤ 0) is exactly 1/16
    expect(calc('BINOM.INV(4,0.5,0.0626)')).toBe(1);
  });
});

describe('Poisson and negative binomial', () => {
  it('POISSON.DIST is the upper incomplete gamma', () => {
    expect(quick('POISSON.DIST(500000000,500000000,TRUE)')).toBeCloseTo(0.5, 4); // 1/2 plus about half the mass at the mean, 9E-6
    relative('POISSON.DIST(5000000,5000000,TRUE)', 0.50011894160470389926, 1e-12);
    expect(calc('POISSON.DIST(1000,1000,TRUE)')).toBeCloseTo(0.50840936716850599121, 13);
    expect(calc('POISSON.DIST(2,5,TRUE)')).toBeCloseTo(0.12465201948308114129, 13);
    expect(calc('POISSON.DIST(100,50,TRUE)')).toBeCloseTo(0.99999999984302540276, 14);
    relative('POISSON.DIST(10,50,TRUE)', 6.4501529184977250649e-12);
    expect(calc('POISSON.DIST(2,5,FALSE)')).toBeCloseTo(0.084224, 6);
    expect(calc('POISSON.DIST(0,0,TRUE)')).toBe(1);
    expect(calc('POISSON.DIST(3,0,TRUE)')).toBe(1);
    expect(calc('POISSON.DIST(3,0,FALSE)')).toBe(0);
  });

  it('NEGBINOM.DIST is the incomplete beta', () => {
    expect(quick('NEGBINOM.DIST(500000000,500000000,0.5,TRUE)')).toBeCloseTo(0.50001261566260694689, 13);
    expect(calc('NEGBINOM.DIST(3000,3000,0.5,TRUE)')).toBeCloseTo(0.50515010810133532356, 13);
    expect(calc('NEGBINOM.DIST(10,5,0.25,TRUE)')).toBeCloseTo(0.31351405847817659378, 13);
    expect(calc('NEGBINOM.DIST(200000000,100000000,0.4,TRUE)')).toBe(1);
    expect(calc('NEGBINOM.DIST(10,5,0.25,FALSE)')).toBeCloseTo(0.0550487, 6);
    expect(calc('NEGBINOM.DIST(3000,3000,0.5,FALSE)')).toBeCloseTo(0.0051501081, 9);
    expect(calc('NEGBINOM.DIST(2,3,0.5,FALSE)')).toBeCloseTo(0.1875, 12);
  });
});

describe('hypergeometric', () => {
  it('HYPGEOM.DIST sums only the terms that matter, out from the mode', () => {
    expect(quick('HYPGEOM.DIST(500000000,1000000000,1000000000,2000000000,TRUE)', 2000)).toBeCloseTo(0.5000178412411548, 10); // 1/2 + mass at the mode / 2
    expect(quick('HYPGEOM.DIST(5000000,10000000,10000000,20000000,TRUE)')).toBeCloseTo(0.5001784124049248118, 12);
    relative('HYPGEOM.DIST(100,300,400,1000,TRUE)', 0.0028699384504345971);
    expect(calc('HYPGEOM.DIST(150,300,400,1000,TRUE)')).toBeCloseTo(0.99999045898874049739, 13);
    expect(calc('HYPGEOM.DIST(300,300,400,1000,TRUE)')).toBe(1);
    expect(calc('HYPGEOM.DIST(1,4,8,20,TRUE)')).toBeCloseTo(0.4654, 4); // the documented example
    expect(calc('HYPGEOM.DIST(1,4,8,20,FALSE)')).toBeCloseTo(0.3633, 4);
  });
});

describe('Bessel orders', () => {
  it('refuses an order past a million instead of recurring a billion times', () => {
    for (const f of ['BESSELJ', 'BESSELY', 'BESSELI', 'BESSELK']) {
      expect(quick(`${f}(1000000000,1000000000)`, 100)).toEqual({ error: '#NUM!' });
      expect(quick(`${f}(3,1000001)`, 100)).toEqual({ error: '#NUM!' });
    }
    expect(calc('BESSELJ(1.9,2)')).toBeCloseTo(0.329926, 5);
    expect(calc('BESSELI(2,3)')).toBeCloseTo(0.212740, 5);
  });
});
