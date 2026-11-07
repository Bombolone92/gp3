import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('rounds large values and many places without drifting', () => {
  expect(calc('ROUND(1234567890.4,0)')).toBe(1234567890);
  expect(calc('ROUND(2000000000.3,0)')).toBe(2000000000);
  expect(calc('ROUND(987654321.2,0)')).toBe(987654321);
  expect(calc('ROUND(1234.5678,10)')).toBe(1234.5678);
  expect(calc('ROUND(1/3,12)')).toBe(0.333333333333);
  expect(calc('ROUND(0.1+0.2,15)')).toBe(0.3);
  expect(calc('ROUND(1E+20,0)')).toBe(1e20);
});

it('still rounds half away from zero and heals binary error', () => {
  expect(calc('ROUND(2.5,0)')).toBe(3);
  expect(calc('ROUND(-2.5,0)')).toBe(-3);
  expect(calc('ROUND(1.005,2)')).toBe(1.01);
  expect(calc('ROUND(2.675,2)')).toBe(2.68);
  expect(calc('ROUND(-1.005,2)')).toBe(-1.01);
  expect(calc('ROUND(1234.567,-2)')).toBe(1200);
  expect(calc('ROUND(-1250,-2)')).toBe(-1300);
  expect(calc('ROUND(0,3)')).toBe(0);
  expect(calc('ROUND(1.5,"x")')).toEqual({ error: '#VALUE!' });
});
