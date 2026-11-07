import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The incomplete gamma series was capped at 500 terms, though it needs about
// 7√a near x = a, and its prefactor exp(a ln x - x - lnΓ(a)) cancelled to a
// few digits for shapes in the millions. The series and continued fraction now
// run as far as √a demands with a Stirling-conditioned prefactor, and Temme's
// uniform expansion takes over from a = 1E8. References: 30- to 40-digit
// evaluations of the same series.
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};

describe('gamma and chi-square CDFs at large shapes', () => {
  it('are accurate in the body', () => {
    // The series of 7√a terms carries about √a ε / 7 of rounding: 5E-14 covers a = 50000.
    expect(calc('CHISQ.DIST(100000,100000,TRUE)')).toBeCloseTo(0.5005947081047933114, 13);
    expect(calc('GAMMA.DIST(50000,50000,1,TRUE)')).toBeCloseTo(0.5005947081047933114, 13);
    expect(calc('GAMMA.DIST(5000,5000,1,TRUE)')).toBeCloseTo(0.5018806340338173553, 13);
    // Temme's expansion from a = 1E8 is accurate to the last place.
    expect(calc('CHISQ.DIST(1E9,1E9,TRUE)')).toBeCloseTo(0.500005947080387242, 14);
    expect(calc('CHISQ.DIST.RT(1E9,1E9)')).toBeCloseTo(0.499994052919612758, 14);
    expect(calc('GAMMA.DIST(10.00001131,9,2,TRUE)')).toBeCloseTo(0.068094, 6);
  });

  it('keep both tails', () => {
    relative('GAMMA.DIST(990000,1E6,1,TRUE)', 5.446644693010808671e-24, 1e-11);
    relative('CHISQ.DIST.RT(2020000,2000000)', 1.060699747758690144e-23, 1e-11);
    relative('GAMMA.DIST(999841886,1E9,1,TRUE)', 2.862701663377988161e-7, 1e-10);
    relative('CHISQ.DIST.RT(2000316228,2E9)', 2.870223808777049725e-7, 1e-10);
    relative('CHISQ.DIST.RT(2002000000,2E9)', 1.252829029663171182e-219, 1e-9);
    expect(calc('GAMMA.DIST(1010000,1E6,1,TRUE)')).toBe(1);
  });

  it('keep the beta prefactor accurate for large parameters too', () => {
    expect(calc('BETA.DIST(0.5,500000000,500000000,TRUE)')).toBeCloseTo(0.5, 14); // I_1/2(a, a) = 1/2 exactly
    expect(calc('F.DIST(1,1E9,1E9,TRUE)')).toBeCloseTo(0.5, 14);
    expect(calc('BETA.DIST(0.5,1000000,1000000,TRUE)')).toBeCloseTo(0.5, 14);
    // T.INV(0.975, 1E6) = 1.959966356814107035 to 19 digits, so its CDF is 0.975 to the last place
    expect(calc('T.DIST(1.959966356814107035,1000000,TRUE)')).toBeCloseTo(0.975, 14);
    expect(calc('BETA.DIST(0.5,2,3,TRUE)')).toBeCloseTo(0.6875, 12);
  });

  it("integrate Student's t at large df where the fraction's denominators cancel", () => {
    relative('T.DIST.RT(2,10000)', 0.02276363033071772137, 1e-13);
    relative('T.DIST.RT(0.5,250)', 0.3087574429596202848, 1e-13);
    relative('T.DIST.RT(3,100000)', 0.001350230442032359595, 1e-13);
    relative('T.DIST.RT(5,1000000)', 2.866998935445370784e-7, 1e-13);
    relative('T.DIST.RT(1,100)', 0.1598620778920616802, 1e-13);
    relative('T.DIST.RT(7.5,1000000)', 3.193505736857425303e-14, 1e-13);
    relative('T.DIST.RT(0.001,1000000)', 0.4996010578858245449, 1e-13);
    relative('T.DIST.RT(1.96,3000)', 0.02504411583618995740, 1e-13);
    relative('T.DIST.RT(9,1000000)', 1.130486516746430186e-19, 1e-13);
    expect(calc('T.DIST(2,10000,TRUE)') + calc('T.DIST.RT(2,10000)')).toBeCloseTo(1, 15);
    expect(calc('T.DIST(0,1000000,TRUE)')).toBe(0.5);
  });

  it('answer at once for shapes in the trillions', () => {
    const t0 = performance.now();
    const v = calc('CHISQ.DIST(1E12,1E12,TRUE)');
    expect(performance.now() - t0).toBeLessThan(500);
    // P(a, a) = 1/2 + 1/(3 sqrt(2 pi a)) + O(a^-3/2) with a = 5E11
    expect(v - 0.5).toBeGreaterThan(1.8806e-7);
    expect(v - 0.5).toBeLessThan(1.8807e-7);
    expect(calc('CHISQ.DIST(1E12,1E12,TRUE)') + calc('CHISQ.DIST.RT(1E12,1E12)')).toBeCloseTo(1, 15);
  });
});
