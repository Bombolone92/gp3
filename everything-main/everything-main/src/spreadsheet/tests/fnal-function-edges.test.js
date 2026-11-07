import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

describe('CONVERT with a unit named like an object property', () => {
  // The unit tables are plain objects, so "constructor" and "toString" looked like units they inherit.
  it('answers #N/A for an unknown unit instead of failing or computing with a function', () => {
    expect(calc('CONVERT(1,"C","toString")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"constructor","constructor")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"g","constructor")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"kconstructor","g")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(1,"valueOf","C")')).toEqual(E('#N/A'));
    expect(calc('CONVERT(100,"C","F")')).toBe(212);
    expect(calc('CONVERT(1,"km","m")')).toBe(1000);
  });
});

describe('reciprocal trigonometric functions at 0', () => {
  // COT, CSC, COTH and CSCH are 1/tan, 1/sin, 1/tanh and 1/sinh, each a division by zero at 0,
  // which is documented as #DIV/0! for COT; the others follow the same definition, as 1/0 does.
  it.each(['COT', 'CSC', 'COTH', 'CSCH'])('%s(0) is #DIV/0!', (fn) => {
    expect(calc(`${fn}(0)`)).toEqual(E('#DIV/0!'));
    expect(calc(`${fn}(A1)`)).toEqual(E('#DIV/0!')); // a blank cell is 0
  });

  it('still evaluate away from 0 and reject text', () => {
    expect(calc('COT(PI()/4)')).toBeCloseTo(1, 12);
    expect(calc('CSC(PI()/2)')).toBeCloseTo(1, 12);
    expect(calc('COTH(2)')).toBeCloseTo(1.0373147, 6);
    expect(calc('CSCH(1)')).toBeCloseTo(0.8509181, 6);
    expect(calc('COT("x")')).toEqual(E('#VALUE!'));
  });
});

describe('DDB factor', () => {
  // The factor is the rate at which the balance declines; a rate of zero or less depreciates
  // nothing or adds value, so it is #NUM!, as VDB already answers.
  it('must be positive', () => {
    expect(calc('DDB(10000,1000,5,1,0)')).toEqual(E('#NUM!'));
    expect(calc('DDB(10000,1000,5,1,-1)')).toEqual(E('#NUM!'));
    expect(calc('DDB(10000,1000,5,1,1.5)')).toBe(3000);
    expect(calc('DDB(10000,1000,5,1)')).toBe(4000);
    expect(calc('VDB(10000,1000,5,0,1,0)')).toEqual(E('#NUM!'));
  });
});

describe('DAYS outside the calendar', () => {
  // DAYS is documented as #NUM! when either date is a number outside the range of valid
  // dates, the same check DAY, MONTH and EDATE make; it took any number.
  it('answers #NUM! for a serial before day 0 or after 31 December 9999', () => {
    expect(calc('DAYS(-1,0)')).toEqual(E('#NUM!'));
    expect(calc('DAYS(0,-1)')).toEqual(E('#NUM!'));
    expect(calc('DAYS(3000000,0)')).toEqual(E('#NUM!'));
    expect(calc('DAYS(2958465,0)')).toBe(2958465);
    expect(calc('DAYS(DATE(2024,3,1),DATE(2024,2,1))')).toBe(29);
    expect(calc('DAYS("2024-03-01","2024-02-01")')).toBe(29);
    expect(calc('DAYS(1.75,0.25)')).toBe(1); // times of day do not count
  });
});

describe('COVARIANCE.P of a single pair', () => {
  // Population covariance is the sum of (x - mean x)(y - mean y) over n, which is 0/1 = 0 for
  // one pair; #DIV/0! is documented only for empty arrays. The sample form divides by n - 1
  // and the regression fits by a zero spread, so they stay #DIV/0!.
  it('is 0, while the sample covariance and the fits still need two pairs', () => {
    expect(calc('COVARIANCE.P(1,2)')).toBe(0);
    expect(calc('COVARIANCE.P({1},{2})')).toBe(0);
    expect(calc('COVAR({5},{7})')).toBe(0);
    expect(calc('COVARIANCE.S({1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('CORREL({1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('RSQ({1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('SLOPE({1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('INTERCEPT({1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('FORECAST(3,{1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('STEYX({1},{2})')).toEqual(E('#DIV/0!'));
    expect(calc('COVARIANCE.P({1,2,3},{2,4,7})')).toBeCloseTo(5 / 3, 12);
    expect(calc('COVARIANCE.P(A1:A2,B1:B2)')).toEqual(E('#DIV/0!')); // no pairs at all
  });
});

describe('FREQUENCY with unsorted bins', () => {
  // The result has one element per bin plus the overflow, and each element answers the bin in
  // the same position of bins_array; the bins are sorted only to count: with bins
  // {3,1} the intervals are (1,3] and up to 1, so the counts are {2;1;2}, not the sorted {1;2;2}.
  it('answers each bin in its own position', () => {
    expect(calc('ARRAYTOTEXT(FREQUENCY({1,2,3,4,5},{3,1}))')).toBe('2, 1, 2');
    expect(calc('ARRAYTOTEXT(FREQUENCY({1,2,3,4,5},{1,3}))')).toBe('1, 2, 2');
    expect(calc('ARRAYTOTEXT(FREQUENCY({79,85,78,85,50,81,95,88,97},{89,70,79}))')).toBe('4, 1, 2, 2');
    expect(calc('ARRAYTOTEXT(FREQUENCY({79,85,78,85,50,81,95,88,97},{70,79,89}))')).toBe('1, 2, 4, 2');
    expect(calc('ARRAYTOTEXT(FREQUENCY({1,2,3,4,5,6},{4,2,2}))')).toBe('2, 2, 0, 2'); // the first of equal bins takes the count
  });
});

describe('CHAR with a fractional code', () => {
  // The code is truncated to a whole number before the 1 to 255 check, as UNICHAR does here and
  // as a numeric argument is truncated: 255.5 is CHAR(255), just as 65.9 was already "A".
  it('truncates before checking the range', () => {
    expect(calc('CODE(CHAR(255.5))')).toBe(255);
    expect(calc('CHAR(255.5)')).toBe(calc('UNICHAR(255.5)'));
    expect(calc('CHAR(65.9)')).toBe('A');
    expect(calc('CHAR(0.5)')).toEqual(E('#VALUE!'));
    expect(calc('CHAR(256)')).toEqual(E('#VALUE!'));
    expect(calc('CHAR("x")')).toEqual(E('#VALUE!'));
  });
});

describe('DATEDIF on serials with a time of day', () => {
  // DATEDIF counts whole days, months and years between two dates; every unit already drops the
  // time, so the check that the start is not after the end must too: 12:00 and 09:36 on the same
  // day are the same date, 0 days apart, not a start after its end.
  it('compares the dates, not the times', () => {
    expect(calc('DATEDIF(45292.5,45292.4,"D")')).toBe(0);
    expect(calc('DATEDIF(45292.5,45292.4,"M")')).toBe(0);
    expect(calc('DATEDIF(45292.5,45292.4,"YD")')).toBe(0);
    expect(calc('DATEDIF(45292.9,45293.1,"D")')).toBe(1);
    expect(calc('DATEDIF(45293,45292.9,"D")')).toEqual(E('#NUM!'));
  });
});

describe('complex arithmetic across i and j', () => {
  // A complex result is written with one suffix; when the arguments name different ones there
  // is no faithful choice, and the answer is #VALUE!. A real number carries no suffix, so it
  // takes the other argument's: IMSUM(2,"1+j") is "3+j", not "3+i".
  it('refuses mixed suffixes and lets a real number take the other suffix', () => {
    expect(calc('IMSUM("1+i","1+j")')).toEqual(E('#VALUE!'));
    expect(calc('IMSUM("1+i",2,"1+j")')).toEqual(E('#VALUE!'));
    expect(calc('IMPRODUCT("1+i","1+j")')).toEqual(E('#VALUE!'));
    expect(calc('IMSUB("1+i","1+j")')).toEqual(E('#VALUE!'));
    expect(calc('IMDIV("1+i","1+j")')).toEqual(E('#VALUE!'));
    expect(calc('IMSUM(2,"1+j")')).toBe('3+j');
    expect(calc('IMSUM("1+j",2,"j")')).toBe('3+2j');
    expect(calc('IMSUB(2,"1+j")')).toBe('1-j');
    expect(calc('IMDIV("2j",2)')).toBe('j');
    expect(calc('IMPRODUCT(2,"1+j")')).toBe('2+2j');
    expect(calc('IMSUM(1,2)')).toBe('3');
    expect(calc('IMSUM("3+4i","1-2i",2)')).toBe('6+2i');
    expect(calc('IMCONJUGATE("1+j")')).toBe('1-j');
    expect(calc('IMSQRT(-1)')).toBe('i'); // a real argument gives the usual i
  });
});
