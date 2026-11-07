import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// XIRR discounts every flow from the first date; a date preceding
// the starting date is documented to give #NUM!, as XNPV already does here.
const NUM = { error: '#NUM!' };

describe('XIRR dates before the first date', () => {
  it('are refused with #NUM!', () => {
    expect(calc('XIRR({-100,110},{44000,43000})')).toEqual(NUM);
    expect(calc('XIRR(A1:A3,B1:B3)', { A1: -1000, A2: 600, A3: 600, B1: 40000, B2: 40100, B3: 39999 })).toEqual(NUM);
  });

  it('later dates in any order still give the rate', () => {
    expect(calc('XIRR({-100,110},{44000,44365})')).toBeCloseTo(0.1, 8);
    expect(calc('XIRR({-1000,600,600},{40000,40500,40100})')).toBeCloseTo(calc('XIRR({-1000,600,600},{40000,40100,40500})'), 10);
    expect(calc('XIRR({-1000,600,600},{40000,40000,40100})')).toBeGreaterThan(0); // the first date itself repeated
  });
});
