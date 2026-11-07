import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// A whole-number power is a product of the number with itself, which is exact
// for small integers; the polar form gave (2+3i)^3 an imaginary part of 9.00000000000001.
it('raises a complex number to a whole power exactly', () => {
  expect(calc('IMPOWER("2+3i",3)')).toBe('-46+9i'); // (2+3i)^2 = -5+12i; times 2+3i = -46+9i
  expect(calc('IMPOWER("1+i",2)')).toBe('2i');
  expect(calc('IMPOWER("1+i",4)')).toBe('-4');
  expect(calc('IMPOWER("3-4i",2)')).toBe('-7-24i');
  expect(calc('IMPOWER("2+3i",0)')).toBe('1');
  expect(calc('IMPOWER("2+3i",1)')).toBe('2+3i');
  expect(calc('IMPOWER("i",10)')).toBe('-1');
  expect(calc('IMPOWER("1+2j",3)')).toBe('-11-2j');
});

it('inverts for negative whole powers and keeps fractional powers in polar form', () => {
  // 1 / (2+3i)^2 = 1 / (-5+12i) = (-5-12i) / 169
  expect(calc('IMREAL(IMPOWER("2+3i",-2))')).toBeCloseTo(-5 / 169, 15);
  expect(calc('IMAGINARY(IMPOWER("2+3i",-2))')).toBeCloseTo(-12 / 169, 15);
  expect(calc('IMPOWER("2i",-1)')).toBe('-0.5i');
  expect(calc('IMREAL(IMPOWER("2+3i",0.5))')).toBeCloseTo(1.6741492280355401, 12);
  expect(calc('IMAGINARY(IMPOWER("2+3i",0.5))')).toBeCloseTo(0.89597747612983814, 12);
  expect(calc('IMPOWER("0",-1)')).toEqual({ error: '#NUM!' });
  expect(calc('IMPOWER("0",3)')).toBe('0');
});
