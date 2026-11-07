import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// EVEN and ODD round away from zero to the next even or odd whole number, taking the
// number at 15 significant digits as every other stepping function does: a number a hair
// above 2 that still shows a digit past 2 in fifteen steps up to 4, and one that does not
// is 2. Before, an absolute tolerance of 1e-12 swallowed anything nearer than that to a
// whole number.
describe('EVEN and ODD at fifteen significant digits', () => {
  it('step up from a number whose excess over a whole number shows within 15 digits', () => {
    expect(calc('EVEN(2.000000000001)')).toBe(4); // 2.000000000001 has 13 significant digits: above 2
    expect(calc('EVEN(1E-13)')).toBe(2); // above 0
    expect(calc('ODD(1+1E-13)')).toBe(3); // 1.0000000000001, 14 significant digits: above 1
    expect(calc('EVEN(2.0000000000001)')).toBe(4);
    expect(calc('ODD(3.0000000000001)')).toBe(5);
    expect(calc('EVEN(-2.000000000001)')).toBe(-4); // away from zero
    expect(calc('ODD(-1E-13)')).toBe(-1);
    expect(calc('EVEN(-1E-13)')).toBe(-2);
  });

  it('take a number at 15 significant digits, as the other stepping functions do', () => {
    expect(calc('EVEN(2.000000000000001)')).toBe(2); // 16 significant digits: 2 to a spreadsheet
    expect(calc('ODD(3.000000000000001)')).toBe(3);
    // 0.3/0.1 is 2.9999999999999996 in binary and 3 to a spreadsheet: 3*20 = 60, already even.
    expect(calc('EVEN(0.3/0.1*20)')).toBe(60);
    expect(calc('ODD(0.3/0.1*20+1)')).toBe(61);
  });

  it('keep the whole-number and ordinary cases', () => {
    expect(calc('EVEN(2)')).toBe(2);
    expect(calc('EVEN(0)')).toBe(0);
    expect(calc('ODD(0)')).toBe(1);
    expect(calc('EVEN(1.5)')).toBe(2);
    expect(calc('EVEN(-1)')).toBe(-2);
    expect(calc('ODD(2)')).toBe(3);
    expect(calc('ODD(-2.5)')).toBe(-3);
    expect(calc('ODD(3)')).toBe(3);
    expect(calc('ODD(-0.5)')).toBe(-1);
  });
});
