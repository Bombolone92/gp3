import { describe, it, expect } from 'vitest';
import { ymdToSerial } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// Date.UTC reads a year from 0 to 99 as 1900 to 1999, so a date computed into those years, by EDATE
// stepping back 1,800 years or by DATE with a year below -1800, came out in the 1990s. Such a year is
// before the calendar: #NUM!, as EOMONTH already answered and as a negative year is.

const NUM = { error: '#NUM!' };

describe('a serial for a year from 0 to 99', () => {
  it('is the year itself, continuous with its neighbours, not the 1900s', () => {
    expect(ymdToSerial(99, 12, 31)).toBeLessThan(0);
    expect(ymdToSerial(100, 1, 1) - ymdToSerial(99, 12, 31)).toBe(1);
    expect(ymdToSerial(0, 1, 1) - ymdToSerial(-1, 12, 31)).toBe(1);
    expect(ymdToSerial(0, 3, 1) - ymdToSerial(0, 2, 28)).toBe(2); // the year 0 is a leap year of the proleptic calendar
    expect(ymdToSerial(50, 13, 1)).toBe(ymdToSerial(51, 1, 1));
    expect(ymdToSerial(1999, 1, 1)).toBe(36161);
    expect(ymdToSerial(1900, 1, 1)).toBe(1);
  });
});

describe('DATE and EDATE outside the calendar', () => {
  it('answer #NUM! for a year before 0 or a result there, as EOMONTH does', () => {
    expect(calc('EDATE(DATE(1900,1,1),-21612)')).toEqual(NUM);
    expect(calc('EDATE(0,-21600)')).toEqual(NUM);
    expect(calc('EOMONTH(0,-21600)')).toEqual(NUM);
    expect(calc('DATE(-1900,1,1)')).toEqual(NUM);
    expect(calc('DATE(-1801,12,31)')).toEqual(NUM);
    expect(calc('DATE(-1800,1,1)')).toEqual(NUM);
    expect(calc('DATE(-1,1,1)')).toEqual(NUM);
    expect(calc('DATE(-0.5,1,1)')).toEqual(NUM);
  });

  it('keep the years DATE adds 1900 to, and the months EDATE steps', () => {
    expect(calc('DATE(0,1,1)')).toBe(1);
    expect(calc('DATE(99,1,1)')).toBe(36161);
    expect(calc('DATE(1899,12,31)')).toBe(calc('DATE(3799,12,31)'));
    expect(calc('DATE(2024,2,29)')).toBe(45351);
    expect(calc('EDATE(DATE(2024,1,31),1)')).toBe(45351);
    expect(calc('EDATE(DATE(2000,1,1),-1200)')).toBe(1);
    expect(calc('EDATE(DATE(1900,3,1),-1)')).toBe(calc('DATE(1900,2,1)'));
    expect(calc('EDATE(DATE(9999,12,31),1)')).toEqual(NUM);
  });
});
