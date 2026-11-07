import { describe, it, expect } from 'vitest';
import { parseAmount, totalsByCurrency, formatTotals, formatMoney } from '../src/lib/money.js';

describe('parseAmount', () => {
  it('reads plain and formatted numbers', () => {
    expect(parseAmount('12.34')).toBe(12.34);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('1,234')).toBe(1234);
    expect(parseAmount('$ 40')).toBe(40);
    expect(parseAmount('EUR 40.10')).toBe(40.1);
    expect(parseAmount(7)).toBe(7);
  });
  it('understands negatives written every common way', () => {
    expect(parseAmount('-12.34')).toBe(-12.34);
    expect(parseAmount('(12.34)')).toBe(-12.34);
    expect(parseAmount('12.34-')).toBe(-12.34);
    expect(parseAmount('$-12.34')).toBe(-12.34);
  });
  it('returns null when nothing numeric is present', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(NaN)).toBeNull();
  });
});

describe('totals', () => {
  it('sums per currency and formats base currency first', () => {
    const map = totalsByCurrency([{ amount: 10, currency: 'EUR' }, { amount: 5.5, currency: 'USD' }, { amount: 4.5, currency: 'USD' }]);
    expect(map.get('USD')).toBe(10);
    expect(map.get('EUR')).toBe(10);
    const text = formatTotals(map, 'USD');
    expect(text.indexOf(formatMoney(10, 'USD'))).toBe(0);
    expect(text).toContain(' + ');
  });
  it('formats zero for an empty set', () => {
    expect(formatTotals(new Map(), 'USD')).toBe(formatMoney(0, 'USD'));
  });
});
