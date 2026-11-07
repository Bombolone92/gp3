import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// XNPV discounts every flow from the first date, and answers #NUM! when a
// later entry precedes it instead of compounding the flow into the past.
const flows = { A1: -1000, A2: 600, A3: 600 };

it('rejects a date before the first date', () => {
  expect(calc('XNPV(0.1,A1:A3,B1:B3)', { ...flows, B1: 40000, B2: 39000, B3: 40500 })).toEqual({ error: '#NUM!' });
  expect(calc('XNPV(0.1,A1:A3,B1:B3)', { ...flows, B1: 40000, B2: 40100, B3: 39999 })).toEqual({ error: '#NUM!' });
});

it('accepts later dates in any order, the first date itself repeated, and keeps the value', () => {
  // 600 / 1.1^(100/365) + 600 / 1.1^(500/365) - 1000
  const expected = 600 / 1.1 ** (100 / 365) + 600 / 1.1 ** (500 / 365) - 1000;
  expect(calc('XNPV(0.1,A1:A3,B1:B3)', { ...flows, B1: 40000, B2: 40100, B3: 40500 })).toBeCloseTo(expected, 9);
  expect(calc('XNPV(0.1,A1:A3,B1:B3)', { ...flows, B1: 40000, B2: 40500, B3: 40100 })).toBeCloseTo(expected, 9);
  expect(calc('XNPV(0.1,A1:A3,B1:B3)', { ...flows, B1: 40000, B2: 40000, B3: 40100 })).toBeCloseTo(600 + 600 / 1.1 ** (100 / 365) - 1000, 9);
});
