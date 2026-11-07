import { describe, it, expect } from 'vitest';
import { parseAmount } from '../src/ui/fields.js';

describe('parseAmount', () => {
  it.each([
    ['1,234.50', 123450],
    ['$ 99', 9900],
    ['(45.00)', -4500],
    ['-12', -1200],
    ['12.50-', -1250],
    ['120*3', 36000],
    ['100+25.5', 12550],
    ['100 + 25.5', 12550],
    ['100-150', -5000],
    ['-100+50', -5000],
    ['100+-50', 5000],
    ['100*-2', -20000],
    ['$100+$50', 15000],
    ['1,000*2', 200000],
    ['10/3', 333],
    ['10/0', 1000],
  ])('%s -> %i', (input, cents) => {
    expect(parseAmount(input)).toBe(cents);
  });

  it('is null for blank text', () => {
    expect(parseAmount('')).toBe(null);
    expect(parseAmount('  ')).toBe(null);
  });

  it('refuses arithmetic it cannot follow instead of joining the digits', () => {
    expect(parseAmount('100+')).toBeNaN();
    expect(parseAmount('(100)+5')).toBeNaN();
    expect(parseAmount('100++5')).toBeNaN();
  });
});
