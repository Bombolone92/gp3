import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Γ(n) is (n-1)!, a defined value, so GAMMA of a positive whole number up to 171 is the exact
// factorial FACT already computes, and GAMMALN of one is its logarithm, with GAMMALN(1) and
// GAMMALN(2) exactly 0, instead of the Lanczos approximation's 23.99999999999996 for
// GAMMA(5), which =GAMMA(5)=24 called FALSE, and a visible -8.88E-16 for GAMMALN(1).
describe('GAMMA and GAMMALN at whole numbers', () => {
  it('give the exact factorial', () => {
    expect(calc('GAMMA(1)')).toBe(1);
    expect(calc('GAMMA(2)')).toBe(1);
    expect(calc('GAMMA(5)')).toBe(24);
    expect(calc('GAMMA(10)')).toBe(362880);
    expect(calc('GAMMA(5)=24')).toBe(true);
    expect(calc('GAMMA(171)')).toBe(calc('FACT(170)'));
    expect(calc('GAMMA(172)')).toEqual({ error: '#NUM!' });
  });

  it('give the exact logarithm of the factorial', () => {
    expect(calc('GAMMALN(1)')).toBe(0);
    expect(calc('GAMMALN(2)')).toBe(0);
    expect(calc('GAMMALN(1)=0')).toBe(true);
    expect(calc('GAMMALN(5)')).toBe(Math.log(24));
    expect(calc('GAMMALN.PRECISE(5)')).toBe(Math.log(24));
    expect(calc('GAMMALN(100)')).toBeCloseTo(359.1342053695754, 10);
    expect(calc('GAMMALN(1000)')).toBeCloseTo(5905.220423209181, 8); // past 171 the approximation carries on
  });

  it('keep the other values', () => {
    expect(calc('GAMMA(0.5)')).toBeCloseTo(Math.sqrt(Math.PI), 14);
    expect(calc('GAMMA(2.5)')).toBeCloseTo(1.329340388179137, 12);
    expect(calc('GAMMA(-1.5)')).toBeCloseTo(2.3632718012073548, 12);
    expect(calc('GAMMALN(4.5)')).toBeCloseTo(2.453736570842442, 12);
    expect(calc('GAMMA(0)')).toEqual({ error: '#NUM!' });
    expect(calc('GAMMA(-2)')).toEqual({ error: '#NUM!' });
    expect(calc('GAMMALN(0)')).toEqual({ error: '#NUM!' });
  });
});
