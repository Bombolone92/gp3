import { describe, it, expect } from 'vitest';
import {
  isCurrencyCode, normalizeCurrency, sortedTotals, convertTotals,
} from '../src/lib/money.js';

describe('currency codes', () => {
  it('accepts three letters in any case', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('eur')).toBe(true);
    expect(normalizeCurrency('gbp')).toBe('GBP');
    expect(normalizeCurrency('  chf ')).toBe('CHF');
  });

  it('rejects anything else, so a typo never becomes a currency', () => {
    for (const bad of ['US', 'USDD', 'US1', '', null, undefined, 12]) {
      expect(isCurrencyCode(bad)).toBe(false);
      expect(normalizeCurrency(bad)).toBe('USD');
    }
    expect(normalizeCurrency('nope', '')).toBe('');
  });
});

describe('sortedTotals', () => {
  it('orders by amount, largest first', () => {
    const out = sortedTotals({ EUR: 19200, USD: 84000, GBP: 4000 });
    expect(out.map((t) => t.currency)).toEqual(['USD', 'EUR', 'GBP']);
  });

  it('drops empty, zero, and unusable totals', () => {
    expect(sortedTotals({ USD: 0, EUR: null, GBP: NaN, CHF: -5 })).toEqual([]);
    expect(sortedTotals(undefined)).toEqual([]);
  });

  it('breaks amount ties on the code so order is stable', () => {
    const out = sortedTotals({ SEK: 100, EUR: 100 });
    expect(out.map((t) => t.currency)).toEqual(['EUR', 'SEK']);
  });
});

describe('convertTotals', () => {
  const rates = { EUR: { rate: 1.08, at: '2026-08-01' }, GBP: { rate: 1.27, at: '2026-08-01' } };

  it('sums using the rates given, leaving the target currency alone', () => {
    const { total, missing } = convertTotals({ USD: 1000, EUR: 1000 }, 'USD', rates);
    expect(total).toBe(2080);
    expect(missing).toEqual([]);
  });

  it('refuses a partial total and names what is missing', () => {
    const { total, missing } = convertTotals({ USD: 1000, EUR: 1000, SEK: 500 }, 'USD', rates);
    expect(total).toBeNull();
    expect(missing).toEqual(['SEK']);
  });

  it('treats absent, zero, and nonsense rates as missing', () => {
    const bad = { EUR: { rate: 0 }, GBP: { rate: 'about one' } };
    expect(convertTotals({ EUR: 10, GBP: 10 }, 'USD', bad).missing).toEqual(['EUR', 'GBP']);
  });

  it('has nothing to say without a target currency', () => {
    expect(convertTotals({ USD: 100 }, '', rates)).toEqual({ total: null, missing: [] });
  });
});
