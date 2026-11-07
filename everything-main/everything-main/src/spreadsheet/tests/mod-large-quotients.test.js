import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// n - d * floor(n / d) is exact only while the quotient fits in 53 bits; the
// remainder operator is exact for every finite pair, so MOD is built on it.
describe('MOD with quotients beyond 2^53', () => {
  it.each([
    ['MOD(1E+17,7)', 5], // 10^17 = 7 * 14285714285714285 + 5
    ['MOD(1E+20,3)', 1], // 10^20 = 3 * 33333333333333333333 + 1
    ['MOD(-1E+17,7)', 2], // the result takes the divisor's sign: -5 + 7
    ['MOD(1E+17,-7)', -2], // 5 - 7
    ['MOD(2^60,10)', 6], // 1152921504606846976 ends in 6
  ])('%s → %s', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it('keeps the sign rules and the small cases', () => {
    expect(calc('MOD(-7,3)')).toBe(2);
    expect(calc('MOD(7,-3)')).toBe(-2);
    expect(calc('MOD(7,3)')).toBe(1);
    expect(calc('MOD(-7,-3)')).toBe(-1);
    expect(calc('MOD(-6,3)')).toBe(0);
    expect(Object.is(calc('MOD(-6,3)'), -0)).toBe(false);
    expect(calc('MOD(5.5,1)')).toBe(0.5);
    expect(calc('MOD(7,0)')).toEqual({ error: '#DIV/0!' });
  });
});
