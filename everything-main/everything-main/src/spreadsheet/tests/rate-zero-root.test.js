import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The balance RATE drives to zero has the factor ((1+r)^n - 1) / r, which
// cancels to noise as r nears zero and made a loan repaid exactly at cost
// end in #NUM!. expm1 and log1p keep the factor, and its limit n at r = 0.
it('finds a rate of zero', () => {
  expect(Math.abs(calc('RATE(12,-100,1200)'))).toBeLessThan(1e-10);
  expect(Math.abs(calc('RATE(10,-100,1000)'))).toBeLessThan(1e-10);
  expect(Math.abs(calc('RATE(10,-100,1000,0,1)'))).toBeLessThan(1e-10);
  expect(Math.abs(calc('RATE(12,-1E9,1.2E10)'))).toBeLessThan(1e-10);
  expect(Math.abs(calc('RATE(12,-0.000001,0.000012)'))).toBeLessThan(1e-10);
});

it('keeps small and ordinary rates to ten digits', () => {
  // Roots of 1200 (1+r)^12 - 100.5 ((1+r)^12 - 1) / r, and so on, found by bisection in 30-digit arithmetic.
  expect(calc('RATE(12,-100.5,1200)')).toBeCloseTo(0.000768149421226303949, 12);
  expect(calc('RATE(48,-200,7500,0,1)')).toBeCloseTo(0.0110580845216513613, 12);
  expect(calc('RATE(360,-1073.64,200000)*12')).toBeCloseTo(0.0499997344361465067, 10);
  expect(calc('RATE(10,0,-1000,2000)')).toBeCloseTo(0.0717734625362931642, 12);
});

it('still reports #NUM! when no rate balances the flows', () => {
  expect(calc('RATE(10,100,1000)')).toEqual({ error: '#NUM!' });
});
