import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// ACCRINT on basis 1 took rate × par × YEARFRAC(issue, settlement, 1), a fraction of a calendar
// year, where it should sum the accrued fraction of each quasi-coupon period laid out every 12/frequency
// months from first_interest: for a bond issued 1 January 2008 paying semi-annually from 1 July and
// settled 1 December, 182/182 + 153/184 half-years of coupon, 91.576087, not 335/366 of a year's
// interest, 91.530055. That term is the accrued interest inside PRICE, so the two now agree on
// basis 1 as they did on the other bases. calc_method, the eighth argument, was read by nobody:
// FALSE counts from first_interest once the settlement is past it.
describe('ACCRINT', () => {
  it('sums the quasi-coupon periods on basis 1', () => {
    expect(calc('ACCRINT(DATE(2008,1,1),DATE(2008,7,1),DATE(2008,12,1),0.1,1000,2,1)')).toBeCloseTo(1000 * 0.05 * (182 / 182 + 153 / 184), 9);
    // Across several periods, each is a whole until the last.
    expect(calc('ACCRINT(DATE(2007,1,1),DATE(2007,7,1),DATE(2008,12,1),0.1,1000,2,1)')).toBeCloseTo(1000 * 0.05 * (3 + 153 / 184), 9);
    // Within the first period the fraction is of that period's own length, 29 February to 31 August.
    expect(calc('ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,1)')).toBeCloseTo(1000 * 0.05 * (61 / 184), 9);
    // The documented example on basis 0 still holds.
    expect(calc('ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)')).toBeCloseTo(16.666667, 5);
  });

  it('agrees with the accrued interest inside PRICE on every basis', () => {
    for (const basis of [0, 1, 2, 3, 4]) {
      const accrued = calc(`100*0.1/2*COUPDAYBS(DATE(2008,5,1),DATE(2010,8,31),2,${basis})/COUPDAYS(DATE(2008,5,1),DATE(2010,8,31),2,${basis})`);
      expect(calc(`ACCRINT(DATE(2008,2,29),DATE(2008,8,31),DATE(2008,5,1),0.1,100,2,${basis})`)).toBeCloseTo(accrued, 9);
    }
  });

  it('counts from first_interest with calc_method FALSE once the settlement is past it', () => {
    expect(calc('ACCRINT(DATE(2008,1,1),DATE(2008,7,1),DATE(2008,12,1),0.1,1000,2,1,FALSE)')).toBeCloseTo(1000 * 0.05 * (153 / 184), 9);
    expect(calc('ACCRINT(DATE(2008,1,1),DATE(2008,7,1),DATE(2008,12,1),0.1,1000,2,0,FALSE)')).toBeCloseTo(1000 * 0.1 * 150 / 360, 9);
    expect(calc('ACCRINT(DATE(2008,1,1),DATE(2008,7,1),DATE(2008,12,1),0.1,1000,2,1,TRUE)')).toBeCloseTo(1000 * 0.05 * (182 / 182 + 153 / 184), 9);
    // Before first_interest the method makes no difference: the documentation's examples.
    expect(calc('ACCRINT(DATE(2008,3,5),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0,FALSE)')).toBeCloseTo(15.555556, 5);
    expect(calc('ACCRINT(DATE(2008,4,5),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0,TRUE)')).toBeCloseTo(7.2222222, 5);
    expect(calc('ACCRINT(DATE(2008,1,1),DATE(2008,7,1),DATE(2008,12,1),0.1,1000,2,1,"x")')).toEqual({ error: '#VALUE!' });
  });
});
