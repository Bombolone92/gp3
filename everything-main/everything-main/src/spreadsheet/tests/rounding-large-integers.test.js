import { describe, expect, it } from 'vitest';
import { calc, calcValues } from './helpers/calc.js';

// Stepping and rounding functions decide on a value's 15 significant digits so
// 0.3 / 0.1 (2.9999999999999996 in binary) reads as 3. A value that needs 16 or
// 17 digits cannot be snapped that way: 1234567890123456 became 1234567890123460,
// so FLOOR exceeded its argument and ROUND moved an integer to another integer.
// Preserve the actual 16-digit input in a cell; a formula literal truncates it.
describe('rounding values the 15 digits cannot express', () => {
  it.each([
    ['FLOOR(A1,1)', 1234567890123456],
    ['CEILING(A1,1)', 1234567890123456],
    ['MROUND(A1,1)', 1234567890123456],
    ['FLOOR.MATH(A1,1)', 1234567890123456],
    ['CEILING.MATH(A1,1)', 1234567890123456],
    ['ROUND(A1,0)', 1234567890123456],
    ['ROUNDUP(A1,0)', 1234567890123456],
    ['ROUNDDOWN(A1,0)', 1234567890123456],
    ['TRUNC(A1)', 1234567890123456],
    ['ROUND(2^53,0)-2^53', 0],
    ['FLOOR(2^53,1)-2^53', 0],
    ['ROUND(-A1,0)', -1234567890123456],
    ['FLOOR(-A1,1)', -1234567890123456],
    // 1E+20 is not a multiple of 3, but its ceiling (1E+20 + 2) rounds back to 1E+20 as a double; the old answer was below the input.
    ['CEILING(1E+20,3)', 1e20],
    ['FLOOR(1E+20,3)', 1e20],
    ['ROUND(1E+20,0)', 1e20],
  ])('%s → %s', (formula, expected) => {
    expect(calcValues(formula, {A1:1234567890123456})).toBe(expected);
  });

  it('never rounds an integer above its argument in FLOOR or below it in CEILING', () => {
    for (const n of [1234567890123456, 9007199254740993, 1e17 + 16, 123456789012345678]) {
      expect(calcValues('FLOOR(A1,1)', {A1:n})).toBeLessThanOrEqual(n);
      expect(calcValues('CEILING(A1,1)', {A1:n})).toBeGreaterThanOrEqual(n);
      expect(calcValues('FLOOR(A1,7)', {A1:n})).toBeLessThanOrEqual(n);
      expect(calcValues('CEILING(A1,7)', {A1:n})).toBeGreaterThanOrEqual(n);
    }
  });

  it('still heals binary noise below 15 digits', () => {
    expect(calc('FLOOR(0.3,0.1)')).toBe(0.3);
    expect(calc('CEILING(4.3,0.7)')).toBe(4.9);
    expect(calc('MROUND(1.15,0.1)')).toBe(1.2);
    expect(calc('ROUND(1.005,2)')).toBe(1.01);
    expect(calc('ROUND(0.1+0.2,15)')).toBe(0.3);
    expect(calc('TRUNC(4.35*100)')).toBe(435);
    expect(calc('ROUNDDOWN(1.1*3,1)')).toBe(3.3);
  });
});
