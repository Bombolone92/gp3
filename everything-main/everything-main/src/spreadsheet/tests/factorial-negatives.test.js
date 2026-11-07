import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// FACT and FACTDOUBLE truncate their argument but refuse a negative
// one first, so -0.5 is #NUM! rather than the factorial of 0.
it('rejects negative arguments before truncating them', () => {
  expect(calc('FACT(-0.5)')).toEqual({ error: '#NUM!' });
  expect(calc('FACT(-1)')).toEqual({ error: '#NUM!' });
  expect(calc('FACTDOUBLE(-1)')).toEqual({ error: '#NUM!' });
  expect(calc('FACTDOUBLE(-0.5)')).toEqual({ error: '#NUM!' });
  expect(calc('FACTDOUBLE(-2)')).toEqual({ error: '#NUM!' });
});

it('keeps the non-negative cases', () => {
  expect(calc('FACT(0)')).toBe(1);
  expect(calc('FACT(0.5)')).toBe(1);
  expect(calc('FACT(5)')).toBe(120);
  expect(calc('FACTDOUBLE(0)')).toBe(1);
  expect(calc('FACTDOUBLE(0.5)')).toBe(1);
  expect(calc('FACTDOUBLE(1)')).toBe(1);
  expect(calc('FACTDOUBLE(7)')).toBe(105);
  expect(calc('FACTDOUBLE(6)')).toBe(48);
});
