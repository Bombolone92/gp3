import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// BINOM.INV is the smallest count whose cumulative probability reaches alpha: at alpha 1 that is every
// trial a success, at alpha 0 no trial at all. Only an alpha below 0 or above 1 is refused.

const NUM = { error: '#NUM!' };

describe('BINOM.INV at the ends of alpha', () => {
  it('answers n at 1 and 0 at 0, and refuses only what lies outside', () => {
    expect(calc('BINOM.INV(10,0.5,1)')).toBe(10);
    expect(calc('BINOM.INV(10,0.5,0)')).toBe(0);
    expect(calc('CRITBINOM(10,0.5,1)')).toBe(10);
    expect(calc('BINOM.INV(10,0.5,0.5)')).toBe(5);
    expect(calc('BINOM.INV(10,0,1)')).toBe(0);
    expect(calc('BINOM.INV(10,1,0.5)')).toBe(10);
    expect(calc('BINOM.INV(0,0.5,1)')).toBe(0);
    expect(calc('BINOM.INV(10,0.5,-0.1)')).toEqual(NUM);
    expect(calc('BINOM.INV(10,0.5,1.1)')).toEqual(NUM);
    expect(calc('BINOM.INV(-1,0.5,0.5)')).toEqual(NUM);
    expect(calc('BINOM.INV(10,1.5,0.5)')).toEqual(NUM);
  });
});
