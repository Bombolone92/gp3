import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// A right tail computed as 1 - CDF keeps at most sixteen digits of the CDF,
// so a tail below 1E-16 vanished and one near 1E-13 kept three digits. The
// tail is now the direct result of the continued fraction (gamma) or of the
// incomplete beta on the appropriate side. Reference values are closed forms
// or 40-digit mpmath evaluations; a relative bound of 1E-12 leaves room for
// the exponent of a value like e^-500 carrying ~1E-13 of rounding.
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};

describe('chi-square right tails', () => {
  it('keep the tail below 1E-16', () => {
    relative('CHISQ.DIST.RT(100,2)', 1.928749847963917783e-22); // e^-50
    relative('CHISQ.DIST.RT(60,2)', 9.357622968840174605e-14); // e^-30
    relative('CHIDIST(1000,3)', 1.799420876531447663e-216);
    relative('CHISQ.DIST.RT(18.307,10)', 0.050001, 1e-4);
    expect(calc('CHISQ.DIST.RT(0.5,1)') + calc('CHISQ.DIST(0.5,1,TRUE)')).toBeCloseTo(1, 15);
    expect(calc('CHISQ.DIST.RT(0,4)')).toBe(1);
  });

  it('CHISQ.TEST keeps a tiny p-value', () => {
    // statistic 4 * 49.5^2 / 50.5 on one degree of freedom: erfc(sqrt(statistic / 2))
    relative('CHISQ.TEST({100,1;1,100},{50.5,50.5;50.5,50.5})', 4.092384490108753355e-44);
    relative('CHISQ.TEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})', 0.000308, 5e-3);
  });
});

describe("Student's t right tails", () => {
  it('keep the tail for large statistics', () => {
    relative('T.DIST.RT(1E8,2)', 4.99999999999999925e-17);
    relative('T.DIST.RT(50,10)', 1.237155164651339987e-13);
    relative('T.DIST.2T(50,10)', 2.474310329302679975e-13);
    relative('TDIST(50,10,1)', 1.237155164651339987e-13);
    relative('TDIST(50,10,2)', 2.474310329302679975e-13);
    relative('T.DIST.RT(1E6,1)', 3.183098861836845682e-7);
    expect(calc('T.DIST.RT(-1E8,2)')).toBe(1);
    expect(calc('T.DIST.RT(0,5)')).toBe(0.5);
    relative('T.DIST.RT(1.959999998,60)', 0.027322, 1e-4);
  });

  it('T.TEST keeps a tiny p-value', () => {
    // paired differences -1E6, -1E6-1.5, -1E6: t = -(2E6+1) on 2 degrees of freedom, p = 1 - |t| / sqrt(t^2 + 2)
    relative('T.TEST({0,0,0},{1E6,1E6+1.5,1E6},2,1)', 2.499997500000937501e-13);
    relative('T.TEST({0,0,0},{1E6,1E6+1.5,1E6},1,1)', 1.249998750000468750e-13);
    relative('T.TEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},2,1)', 0.196016, 1e-5);
  });
});

describe('F right tails', () => {
  it('keep the tail for large ratios', () => {
    relative('F.DIST.RT(1E18,2,2)', 1e-18); // 1 / (1 + x)
    relative('F.DIST.RT(1000,5,10)', 3.707168098708697135e-13);
    relative('FDIST(15.2069,6,4)', 0.01, 1e-4);
    expect(calc('F.DIST.RT(0,3,4)')).toBe(1);
  });

  it('F.TEST keeps a tiny p-value and is symmetric', () => {
    // variance ratio F = 7300801.7 / 2.5 on (4, 4) degrees of freedom: 2 I_y(2, 2) with y = 1 / (1 + F)
    relative('F.TEST({1,1000,2000,-5000,3},{1,2,3,4,5})', 7.035415739827171467e-13, 1e-11);
    relative('F.TEST({1,2,3,4,5},{1,1000,2000,-5000,3})', 7.035415739827171467e-13, 1e-11);
  });
});
