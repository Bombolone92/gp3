import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// T.INV, T.INV.2T and CONFIDENCE.T bisected inside a fixed ±10000 bracket and
// so returned 9999.99 for any quantile beyond it. The bracket now grows until
// it holds the quantile. References: tan(π(p - 1/2)) for one degree of
// freedom, u√2/√(1-u²) with u = 2p - 1 for two, 40-digit bisections otherwise.
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};

describe("Student's t inverses beyond ten thousand", () => {
  it('reach the quantile', () => {
    relative('T.INV(0.00001,1)', -31830.98860790709164);
    relative('T.INV.2T(0.00001,1)', 63661.97723152214655);
    relative('TINV(0.00001,1)', 63661.97723152214655);
    relative('CONFIDENCE.T(0.00001,1,2)', 45015.81580415290103);
    relative('T.INV(1E-10,2)', -70710.67810804815072);
    relative('T.INV(1E-15,3)', -103311.0835928498867, 1e-11);
    relative('T.INV.2T(1E-20,2)', 1e10);
    relative('T.INV(0.99999,1)', 31830.98860790709164, 1e-10);
  });

  it('keep the ordinary quantiles', () => {
    relative('T.INV(0.975,1000000)', 1.959966356814107035);
    relative('T.INV.2T(0.001,30)', 3.645958635042021816);
    relative('T.INV(0.75,2)', 0.816496580927726, 1e-9);
    relative('T.INV.2T(0.546449,60)', 0.606533, 1e-5);
    relative('CONFIDENCE.T(0.05,1,50)', 0.284197, 1e-5);
    expect(calc('T.INV(0.5,7)')).toBe(0);
    expect(calc('T.INV.2T(1,5)')).toBe(0);
    expect(calc('T.DIST.2T(T.INV.2T(1E-20,2),2)')).toBeCloseTo(1e-20, 30);
  });
});
