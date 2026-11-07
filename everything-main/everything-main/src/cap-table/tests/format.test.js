import { describe, it, expect, afterEach, vi } from 'vitest';
import { dateShort } from '../src/lib/format.js';

describe('dateShort', () => {
  it('drops the year within the reference year and keeps it otherwise', () => {
    expect(dateShort('2026-03-12', '2026-08-04')).toBe('Mar 12');
    expect(dateShort('2027-03-12', '2026-08-04')).toBe('Mar 12, 2027');
  });

  it('passes unparseable input through', () => {
    expect(dateShort('', '2026-01-01')).toBe('');
    expect(dateShort('nope', '2026-01-01')).toBe('nope');
  });
});

import { decimalValue } from '../src/lib/format.js';
import { parseNum } from '../src/lib/util.js';

import { amountValue } from '../src/lib/format.js';

describe('amountValue', () => {
  it('groups the whole part and keeps the fraction as written', () => {
    expect(amountValue(18000000)).toBe('18,000,000');
    expect(amountValue(250000.555)).toBe('250,000.555');
    expect(amountValue(0.0000001)).toBe('0.0000001');
    expect(amountValue(-1234.5)).toBe('-1,234.5');
    expect(amountValue(0)).toBe('0');
  });

  it('keeps every digit of a count or amount past a trillion', () => {
    /* decimalValue tidies to twelve significant digits for prices a split
       divided; a 13-digit share count prefilled through it lost its last
       digits and an unrelated edit saved the shorter figure back. */
    expect(amountValue(1234567890123)).toBe('1,234,567,890,123');
    expect(amountValue(999999999999999)).toBe('999,999,999,999,999');
    expect(amountValue(512345678901234)).toBe('512,345,678,901,234');
    expect(amountValue(1000000000000.55)).toBe('1,000,000,000,000.55');
    expect(amountValue(123456789012.5)).toBe('123,456,789,012.5');
    // A division's noise still comes off.
    expect(amountValue(6.300000000000001)).toBe('6.3');
  });
});

describe('decimalValue', () => {
  it('writes out the exponent notation the forms would otherwise prefill', () => {
    expect(decimalValue(1e-7)).toBe('0.0000001');
    // What a 100-for-1 split leaves behind a $0.00001 issue price, less the float noise.
    expect(decimalValue(0.00001 / 100)).toBe('0.0000001');
    expect(decimalValue(6.300000000000001)).toBe('6.3');
    expect(decimalValue(0.00030000000000000003)).toBe('0.0003');
    expect(decimalValue(-2.5e-8)).toBe('-0.000000025');
    expect(decimalValue(1e21)).toBe('1000000000000000000000');
  });

  it('leaves a number that already reads as decimal alone', () => {
    expect(decimalValue(0.0001)).toBe('0.0001');
    expect(decimalValue(123.456)).toBe('123.456');
    expect(decimalValue(0)).toBe('0');
    expect(decimalValue(NaN)).toBe('');
  });

  it('round-trips through the parser the forms validate with', () => {
    // Up to the largest figure a record holds; past it parseNum refuses on purpose.
    for (const n of [1e-7, 1e-21, 0.0001, 100, 123.456, 1e15]) {
      expect(parseNum(decimalValue(n))).toBe(n);
    }
    expect(parseNum(decimalValue(1e21), { max: Infinity })).toBe(1e21);
    // A figure carrying float noise reads back as the figure it stands for.
    expect(parseNum(decimalValue(0.00001 / 100))).toBe(1e-7);
  });
});

import {
  money, moneyWhole, moneyCompact, moneyUSD, sharePrice, shares, sharesLabel, sharesCompact, pct,
  setCurrency, currencyCode, currencySymbol, normalizeCurrency,
} from '../src/lib/format.js';

describe('money', () => {
  it('formats standard amounts with cents', () => {
    expect(money(1234.5)).toBe('$1,234.50');
  });

  it('keeps sub-cent share prices visible', () => {
    expect(money(0.0001)).toBe('$0.0001');
  });

  it('formats whole-dollar figures', () => {
    expect(moneyWhole(18_000_000)).toBe('$18,000,000');
  });

  it('compacts large figures for stat tiles', () => {
    expect(moneyCompact(4_200_000)).toBe('$4.2M');
    expect(moneyCompact(850)).toBe('$850');
    // Under a dollar the cents are the figure: a par-only company read "Capital raised $0".
    expect(moneyCompact(0.1)).toBe('$0.10');
    expect(moneyCompact(0)).toBe('$0');
  });
});

describe('sharePrice', () => {
  it('shows up to four decimals', () => {
    expect(sharePrice(1.8182)).toBe('$1.8182');
    expect(sharePrice(2)).toBe('$2.00');
  });

  it('keeps a par value that four decimals cannot hold', () => {
    /* $0.00001 is the routine Delaware par value, and a forward split takes
       whatever it was lower still. Rounded to four decimals it is nothing,
       and the two-decimal minimum then trims the zeros away - so the price
       read "$0.00" rather than the number that was entered. */
    expect(sharePrice(0.0001)).toBe('$0.0001');
    expect(sharePrice(0.00004)).toBe('$0.00004');
    expect(sharePrice(0.00001)).toBe('$0.00001');
    expect(sharePrice(0.000001)).toBe('$0.000001');
    expect(sharePrice(0)).toBe('$0.00');
  });
});

describe('sharesLabel', () => {
  it('names the unit in the singular for one share', () => {
    expect(sharesLabel(1)).toBe('1 share');
    expect(sharesLabel(0)).toBe('0 shares');
    expect(sharesLabel(2_500)).toBe('2,500 shares');
  });
});

describe('shares', () => {
  it('groups thousands', () => {
    expect(shares(1_470_588)).toBe('1,470,588');
  });

  it('compacts for tiles', () => {
    expect(sharesCompact(12_500_000)).toBe('12.5M');
    expect(sharesCompact(950)).toBe('950');
  });
});

describe('pct', () => {
  it('formats fractions as percentages', () => {
    expect(pct(0.2)).toBe('20.00%');
    expect(pct(0.3333, 1)).toBe('33.3%');
  });

  it('marks tiny-but-real stakes instead of rounding to zero', () => {
    expect(pct(0.00005)).toBe('<0.01%');
    expect(pct(0)).toBe('0.00%');
    // The mirror at the top: a holder listed beside a "<0.01%" stake does not own "100.00%".
    expect(pct(0.999996)).toBe('>99.99%');
    expect(pct(0.99995)).toBe('>99.99%');
    expect(pct(0.9999)).toBe('99.99%');
    expect(pct(0.99996, 1)).toBe('>99.9%');
    // The floor follows the digits shown, as the ceiling does.
    expect(pct(0.004, 0)).toBe('<1%');
    expect(pct(0.00005, 0)).toBe('<1%');
    expect(pct(0.012, 0)).toBe('1%');
    expect(pct(0.0004, 1)).toBe('<0.1%');
    expect(pct(0, 0)).toBe('0%');
    expect(pct(1)).toBe('100.00%');
  });
});

describe('currency', () => {
  // The module holds one active currency, so every case here puts it back.
  afterEach(() => setCurrency('USD'));

  it('normalizes codes and refuses unusable ones', () => {
    expect(normalizeCurrency('eur')).toBe('EUR');
    expect(normalizeCurrency(' gbp ')).toBe('GBP');
    expect(normalizeCurrency('ZZZ')).toBe('USD');
    expect(normalizeCurrency('')).toBe('USD');
    expect(normalizeCurrency(null)).toBe('USD');
  });

  it('formats money in the active currency', () => {
    setCurrency('GBP');
    expect(currencyCode()).toBe('GBP');
    expect(money(1234.5)).toBe('£1,234.50');
    expect(moneyWhole(18_000_000)).toBe('£18,000,000');
    expect(moneyCompact(4_200_000)).toBe('£4.2M');
    expect(sharePrice(1.8182)).toBe('£1.8182');
  });

  it('prints a statutory US-dollar figure as dollars whatever the company banks in', () => {
    setCurrency('GBP');
    expect(moneyUSD(100_000)).toBe('$100,000');
    expect(moneyWhole(100_000)).toBe('£100,000');
  });

  it('keeps sub-unit prices visible in any currency', () => {
    setCurrency('EUR');
    expect(money(0.0001)).toBe('€0.0001');
    expect(sharePrice(0.00001)).toBe('€0.00001');
  });

  it('honors a currency with no minor unit', () => {
    setCurrency('JPY');
    expect(moneyWhole(1_200_000)).toBe('¥1,200,000');
  });

  it('falls back to dollars for an unusable code', () => {
    setCurrency('ZZZ');
    expect(currencyCode()).toBe('USD');
    expect(moneyWhole(1000)).toBe('$1,000');
  });

  it('gives field labels the currency symbol', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('EUR')).toBe('€');
  });

  it('leaves share counts and percentages alone', () => {
    setCurrency('INR');
    expect(shares(1_470_588)).toBe('1,470,588');
    expect(pct(0.2)).toBe('20.00%');
  });
});

import { timeAgo } from '../src/lib/format.js';

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('counts recent moments and names older days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00'));
    const at = (iso) => new Date(iso).getTime();
    expect(timeAgo(at('2026-09-06T11:59:40'))).toBe('just now');
    expect(timeAgo(at('2026-09-06T11:30:00'))).toBe('30m ago');
    expect(timeAgo(at('2026-09-06T09:00:00'))).toBe('3h ago');
    expect(timeAgo(at('2026-09-03T12:00:00'))).toBe('3d ago');
    expect(timeAgo(at('2026-03-12T12:00:00'))).toBe('Mar 12');
  });

  it('keeps the year on a day from another year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00'));
    // A restore point from last summer read "Aug 2", as if taken this year.
    expect(timeAgo(new Date('2025-08-02T12:00:00').getTime())).toBe('Aug 2, 2025');
    // Even a fortnight back, once the calendar has turned.
    vi.setSystemTime(new Date('2027-01-05T12:00:00'));
    expect(timeAgo(new Date('2026-12-20T12:00:00').getTime())).toBe('Dec 20, 2026');
  });
});
