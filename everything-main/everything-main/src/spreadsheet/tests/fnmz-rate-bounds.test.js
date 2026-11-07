import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// A rate at or below -100% leaves no growth factor to discount by ((1+rate) is zero or
// negative), and a number of periods at or below zero is no annuity: #NUM!, as NPV and
// PDURATION already answer for such arguments.
const NUM = { error: '#NUM!' };

describe('rates at or below -100% and periods at or below zero', () => {
  it('XNPV refuses a rate at or below -1, as NPV does', () => {
    expect(calc('XNPV(-2,{-100,110},{44000,44365})')).toEqual(NUM);
    expect(calc('XNPV(-1,{-100,110},{44000,44365})')).toEqual(NUM);
    expect(calc('NPV(-1,-100,110)')).toEqual(NUM);
    expect(calc('XNPV(-0.5,{-100,110},{44000,44365})')).toBeCloseTo(-100 + 110 / 0.5, 9);
  });

  it('NPER refuses a rate at or below -1', () => {
    expect(calc('NPER(-1,-100,1000)')).toEqual(NUM);
    expect(calc('NPER(-1.5,-100,1000)')).toEqual(NUM);
    expect(calc('NPER(0.01,-100,1000)')).toBeCloseTo(Math.log(100 / (100 - 10)) / Math.log(1.01), 9);
  });

  it('RATE refuses a number of periods at or below zero', () => {
    expect(calc('RATE(-10,-100,800)')).toEqual(NUM);
    expect(calc('RATE(0,-100,800)')).toEqual(NUM);
    expect(calc('RATE(10,-100,800)')).toBeGreaterThan(0);
  });
});
