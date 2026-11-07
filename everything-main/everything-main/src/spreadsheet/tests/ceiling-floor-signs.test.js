import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('rejects a positive number with a negative significance', () => {
  expect(calc('CEILING(2.5,-2)')).toEqual({ error: '#NUM!' });
  expect(calc('FLOOR(2.5,-2)')).toEqual({ error: '#NUM!' });
});

it('handles zero significance and negative numbers', () => {
  expect(calc('CEILING(2.5,0)')).toBe(0);
  expect(calc('FLOOR(2.5,0)')).toEqual({ error: '#DIV/0!' });
  expect(calc('CEILING(-2.5,-2)')).toBe(-4);
  expect(calc('FLOOR(-2.5,-2)')).toBe(-2);
  expect(calc('CEILING(-2.5,2)')).toBe(-2);
  expect(calc('FLOOR(-2.5,2)')).toBe(-4);
  expect(calc('CEILING(2.5,1)')).toBe(3);
  expect(calc('FLOOR(2.5,1)')).toBe(2);
  expect(calc('CEILING(0.234,0.01)')).toBeCloseTo(0.24, 10);
  expect(calc('FLOOR(0.234,0.01)')).toBeCloseTo(0.23, 10);
});
