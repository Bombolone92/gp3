import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// When several values share the top count, MODE.MULT lists them in the order
// they first appear, and MODE returns the first of that list: 1 for
// {1,2,2,1}, where the old code returned the value that reached the count first.
it('returns the first-appearing value among those tied at the top count', () => {
  expect(calc('MODE(1,2,2,1)')).toBe(1);
  expect(calc('MODE(2,1,1,2)')).toBe(2);
  expect(calc('MODE({1,2,3,4,3,2,1,2,3,5,6,1})')).toBe(1); // MODE.MULT of these values lists 1, 2, 3
  expect(calc('MODE(1,2,2,1)')).toBe(calc('INDEX(MODE.MULT(1,2,2,1),1)'));
  expect(calc('MODE({1,2,3,4,3,2,1,2,3,5,6,1})')).toBe(calc('INDEX(MODE.MULT({1,2,3,4,3,2,1,2,3,5,6,1}),1)'));
  expect(calc('MODE.SNGL(5,3,3,5,7)')).toBe(5);
});

it('keeps a single mode and the no-repeat error', () => {
  expect(calc('MODE(1,2,2,3)')).toBe(2);
  expect(calc('MODE(3,3,1,2,2,2)')).toBe(2);
  expect(calc('MODE(1,2,3)')).toEqual({ error: '#N/A' });
  expect(calc('MODE(A1:A3)', { A1: 'x', A2: 'y', A3: 'z' })).toEqual({ error: '#N/A' });
});
