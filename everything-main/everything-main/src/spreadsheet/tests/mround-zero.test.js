import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// MROUND refuses a number and a multiple of opposite signs; zero has no sign,
// so MROUND(0,-3) is 0, not #NUM!.
it('rounds zero to any multiple', () => {
  expect(calc('MROUND(0,-3)')).toBe(0);
  expect(calc('MROUND(0,3)')).toBe(0);
  expect(calc('MROUND(0,-0.1)')).toBe(0);
  expect(Object.is(calc('MROUND(0,-3)'), -0)).toBe(false);
});

it('still rejects opposite signs and keeps the sign rules', () => {
  expect(calc('MROUND(-3,3)')).toEqual({ error: '#NUM!' });
  expect(calc('MROUND(3,-3)')).toEqual({ error: '#NUM!' });
  expect(calc('MROUND(-10,-3)')).toBe(-9);
  expect(calc('MROUND(10,3)')).toBe(9);
  expect(calc('MROUND(5,0)')).toBe(0);
});
