import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The bisection behind the inverse distributions stopped at an absolute width
// of 1E-12, which left a quantile of 8E-13 with no correct digit and pushed
// an exact zero to 4E-13. It now stops at a relative width, so every quantile
// keeps about fifteen digits. References: erfinv(p)^2 for the shape-1/2 gamma,
// p itself for BETA.INV(p,1,1), and 40-digit bisections otherwise.
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};

describe('small quantiles', () => {
  it('GAMMA.INV keeps its digits down to the smallest doubles', () => {
    relative('GAMMA.INV(0.000001,0.5,1)', 7.853981633978595431e-13);
    relative('GAMMA.INV(1E-10,3,2)', 0.001687221124969454866);
    relative('GAMMA.INV(1E-300,2,1)', 1.414213562373095049e-150, 1e-10);
    relative('GAMMA.INV(0.5,2,1)', 1.678346990016661, 1e-9);
  });

  it('BETA.INV and CHISQ.INV keep their digits', () => {
    relative('BETA.INV(1E-8,1,1)', 1e-8);
    relative('BETA.INV(1E-20,1,1)', 1e-20);
    relative('BETA.INV(1E-8,2,3)', 4.082594021609240944e-5);
    relative('CHISQ.INV(1E-20,5)', 3.233407795518736837e-8);
    relative('BETA.DIST(BETA.INV(1E-8,2,3),2,3,TRUE)', 1e-8, 1e-11);
    relative('GAMMA.DIST(GAMMA.INV(1E-10,3,2),3,2,TRUE)', 1e-10, 1e-11);
  });

  it('returns an exact zero at the lower boundary', () => {
    expect(calc('CHISQ.INV(0,2)')).toBe(0);
    expect(calc('GAMMA.INV(0,2,1)')).toBe(0);
    expect(calc('CHISQ.INV(-0.1,2)')).toEqual({ error: '#NUM!' });
    expect(calc('CHISQ.INV(1,2)')).toEqual({ error: '#NUM!' });
  });
});
