import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// CHISQ.INV.RT and F.INV.RT inverted the left CDF at 1 - p, which rounds
// 1 - 1E-20 to 1 and made a probability of one impossible. They now bisect
// the right tail itself. References: -2 ln p for two degrees of freedom and
// 40-digit bisections otherwise.
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};

describe('right-tail chi-square inverse', () => {
  it('resolves tiny probabilities', () => {
    relative('CHISQ.INV.RT(1E-20,2)', 92.10340371976182736);
    relative('CHISQ.INV.RT(1E-300,2)', 1381.55105579642741);
    relative('CHISQ.INV.RT(1E-20,5)', 103.4289772377579486);
    relative('CHIINV(0.05,10)', 18.307038, 1e-6);
    relative('CHISQ.DIST.RT(CHISQ.INV.RT(1E-20,5),5)', 1e-20, 1e-10);
  });

  it('answers zero for probability one and rejects zero', () => {
    expect(calc('CHISQ.INV.RT(1,2)')).toBe(0);
    expect(calc('CHISQ.INV.RT(0,2)')).toEqual({ error: '#NUM!' });
  });
});

describe('right-tail F inverse', () => {
  it('resolves tiny probabilities', () => {
    relative('F.INV.RT(1E-20,6,4)', 16329931617.44340954, 1e-11);
    relative('F.INV.RT(1E-10,3,7)', 2135.286098996238892, 1e-11);
    relative('F.INV.RT(1E-300,2,2)', 1e300, 1e-10); // the tail is 1 / (1 + x)
    relative('FINV(0.05,5,10)', 3.325835, 1e-6);
    relative('F.DIST.RT(F.INV.RT(1E-20,6,4),6,4)', 1e-20, 1e-10);
    relative('F.INV(1E-20,4,6)', 6.123724357374611912e-11, 1e-11); // 1 / F.INV.RT(1E-20,6,4)
  });

  it('answers zero at the boundary and rejects the other end', () => {
    expect(calc('F.INV.RT(1,6,4)')).toBe(0);
    expect(calc('F.INV(0,6,4)')).toBe(0);
    expect(calc('F.INV.RT(0,6,4)')).toEqual({ error: '#NUM!' });
    expect(calc('F.INV(1,6,4)')).toEqual({ error: '#NUM!' });
    expect(calc('F.INV.RT(1.5,6,4)')).toEqual({ error: '#NUM!' });
  });
});
