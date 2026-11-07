import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Holidays written as text dates inside an array constant are part of the formula, so they
// count. Text read from cells still does not.
describe('text dates among the holidays', () => {
  it('counts text dates in an array constant', () => {
    expect(calc('NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),7,{"2006/1/2","2006/1/16"})')).toBe(22);
    expect(calc('NETWORKDAYS(DATE(2006,1,1),DATE(2006,2,1),{"2006/1/2","2006/1/16"})')).toBe(21);
    expect(calc('WORKDAY(DATE(2006,1,1),5,{"2006/1/2"})')).toBe(calc('DATE(2006,1,9)'));
    expect(calc('NETWORKDAYS(DATE(2006,1,1),DATE(2006,2,1),{"x"})')).toEqual({ error: '#VALUE!' });
  });

  it('still passes over text held in cells', () => {
    expect(calc('NETWORKDAYS(DATE(2006,1,1),DATE(2006,2,1),A1:A2)', { A1: "'2006/1/2", A2: 'x' })).toBe(23);
  });
});
