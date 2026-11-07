import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// YEARFRAC and DAYS360 read dates, and a serial the calendar has no day for (below 0 or past
// 31 December 9999, serial 2958465) is #NUM!, as it is to YEAR and the other date functions.
describe('YEARFRAC and DAYS360 outside the calendar', () => {
  it('are #NUM! for a serial before day 0 or after the last day', () => {
    expect(calc('YEARFRAC(-1,100,1)')).toEqual(E('#NUM!'));
    expect(calc('YEARFRAC(-1,100)')).toEqual(E('#NUM!'));
    expect(calc('YEARFRAC(1,-100,0)')).toEqual(E('#NUM!'));
    expect(calc('YEARFRAC(1,2958466)')).toEqual(E('#NUM!'));
    expect(calc('DAYS360(-1,100)')).toEqual(E('#NUM!'));
    expect(calc('DAYS360(1,-100)')).toEqual(E('#NUM!'));
    expect(calc('DAYS360(1,2958466)')).toEqual(E('#NUM!'));
    expect(calc('DAYS360(1,2958466,TRUE)')).toEqual(E('#NUM!'));
  });

  it('still take every day of the calendar', () => {
    // Day 0 is January 0 and day 100 is 9 April 1900: 3*30 + 9 = 99 days on a 30/360 basis.
    expect(calc('DAYS360(0,100)')).toBe(99);
    expect(calc('YEARFRAC(0,100)')).toBe(99 / 360);
    // The last day of the calendar, 31 December 9999, from 1 January 9999 (serial 2958101): 360 days, one year.
    expect(calc('DAYS360(2958101,2958465)')).toBe(360);
    expect(calc('YEARFRAC(2958101,2958465)')).toBe(1);
    expect(calc('YEARFRAC(DATE(2024,1,1),DATE(2024,7,1),1)')).toBe(182 / 366); // 182 days of a leap year
  });
});
