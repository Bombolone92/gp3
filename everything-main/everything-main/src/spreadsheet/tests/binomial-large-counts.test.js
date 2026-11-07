import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The probability mass was a binomial coefficient times two powers; past a
// thousand trials the coefficient overflows while the powers underflow.
describe('the binomial family at large counts', () => {
  it('stays finite and accurate', () => {
    expect(calc('BINOM.DIST(525,1050,0.5,FALSE)')).toBeCloseTo(0.02461739, 7);
    expect(calc('BINOM.DIST(2500,5000,0.5,FALSE)')).toBeCloseTo(0.01128323, 7);
    expect(calc('BINOM.DIST(600,1200,0.5,TRUE)')).toBeCloseTo(0.51151407, 6);
    expect(calc('BINOM.DIST(1000,100000,0.01,FALSE)')).toBeCloseTo(0.01267816, 6);
    expect(calc('BINOM.DIST.RANGE(5000,0.5,2400,2600)')).toBeCloseTo(0.99552956, 6);
    expect(calc('BINOM.INV(5000,0.5,0.5)')).toBe(2500);
    expect(calc('BINOM.INV(2000,0.3,0.9)')).toBe(626);
    expect(calc('CRITBINOM(1100,0.5,0.5)')).toBe(550);
    expect(calc('NEGBINOM.DIST(3000,3000,0.5,FALSE)')).toBeCloseTo(0.0051501081, 8);
  });

  it('keeps the small cases and the degenerate probabilities', () => {
    expect(calc('BINOM.DIST(3,10,0.5,FALSE)')).toBeCloseTo(0.1171875, 12);
    expect(calc('BINOM.DIST(3,10,0.5,TRUE)')).toBeCloseTo(0.171875, 12);
    expect(calc('BINOM.DIST(3,10,0,FALSE)')).toBe(0);
    expect(calc('BINOM.DIST(0,10,0,FALSE)')).toBe(1);
    expect(calc('BINOM.DIST(10,10,1,FALSE)')).toBe(1);
    expect(calc('BINOM.DIST(9,10,1,TRUE)')).toBe(0);
    expect(calc('NEGBINOM.DIST(2,3,0.5,FALSE)')).toBeCloseTo(0.1875, 12);
  });
});
