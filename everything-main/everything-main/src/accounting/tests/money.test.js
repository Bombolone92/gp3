import { describe, it, expect } from 'vitest';
import { parseMoney, toCents, formatMoney, allocate, applyRate, lineAmount, centsToInput, parseQty } from '../src/lib/money.js';

describe('parseMoney', () => {
  it.each([
    ['1,234.50', 123450],
    ['$ 99', 9900],
    ['(45.00)', -4500],
    ['-12', -1200],
    ['1.234,50', 123450],
    ['12,5', 1250],
    ['1,234', 123400],
    ['10.005', 1001],
    ['\u221212.00', -1200],
    ['\u2212 1\u00a0234,56 kr', -123456],
    ['\u201312.00', -1200],
    ['', 0],
    ['abc', 0],
    ['0.1', 10],
  ])('%s -> %i', (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });
});

describe('toCents', () => {
  it('rounds floats half away from zero without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-2.675)).toBe(-268);
  });
});

describe('allocate', () => {
  it('always sums to the total', () => {
    for (const [total, weights] of [[100, [1, 1, 1]], [1, [3, 3, 3]], [9999, [12345, 1, 77]], [-100, [1, 2]], [55, [-100, 10, -9]]]) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
  it('keeps the sign of a discount weight', () => {
    const parts = allocate(-99, [-100, 10, -9]);
    expect(parts).toEqual([-100, 10, -9]);
  });
  it('splits evenly with the remainder to the first shares', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
});

describe('helpers', () => {
  it('applies basis-point rates', () => {
    expect(applyRate(10000, 825)).toBe(825);
    expect(applyRate(999, 825)).toBe(82);
  });
  it('multiplies qty by a cents rate', () => {
    expect(lineAmount(3, 1999)).toBe(5997);
    expect(lineAmount(1.5, 10000)).toBe(15000);
  });
  it('formats and round-trips inputs', () => {
    expect(formatMoney(123450, { currency: 'USD', locale: 'en-US' })).toBe('$1,234.50');
    expect(formatMoney(-500, { currency: 'USD', locale: 'en-US' })).toBe('-$5.00');
    expect(centsToInput(-123405)).toBe('-1234.05');
    expect(parseMoney(centsToInput(98765))).toBe(98765);
  });
});

describe('quantities and fractional rates', () => {
  it('reads decimal commas and thousands', () => {
    expect(parseQty('1,5')).toBe(1.5);
    expect(parseQty('1,000')).toBe(1000);
    expect(parseQty('2.25')).toBe(2.25);
    expect(parseQty('')).toBe('');
  });
  it('shows fractional-cent rates without corrupting them', () => {
    const rate = 10000 / 3;
    expect(centsToInput(rate)).toBe('33.333333');
    expect(Math.round(3 * parseMoney(centsToInput(rate)))).toBe(9999);
  });
});
