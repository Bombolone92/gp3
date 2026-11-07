import { expect, it } from 'vitest';
import { formatValue, getLocale, setLocale, numFmtToStyle } from '../src/core/format.js';

it.each([
  ['en-US', 'currency', 'USD', '$1234.50', '$1,234.50'],
  ['de-DE', 'currency', 'EUR', '1234,50\u00a0€', '1.234,50\u00a0€'],
  ['en-US', 'percent', null, '123450.00%', '123,450.00%'],
  ['de-DE', 'percent', null, '123450,00\u00a0%', '123.450,00\u00a0%'],
])('honors grouping for %s %s values', (locale, fmt, cur, plain, grouped) => {
  const previous = getLocale();
  setLocale(locale);
  try {
    expect(formatValue(1234.5, { fmt, cur, dec: 2, group: false })).toBe(plain);
    expect(formatValue(1234.5, { fmt, cur, dec: 2, group: true })).toBe(grouped);
    expect(formatValue(1234.5, { fmt, cur, dec: 2 })).toBe(grouped);
  } finally { setLocale(previous); }
});

it('imports supported currency and percent formats with their grouping setting', () => {
  expect(numFmtToStyle('"$"0.00')).toEqual({ fmt: 'currency', cur: 'USD', dec: 2, group: false });
  expect(numFmtToStyle('€0.00')).toEqual({ fmt: 'currency', cur: 'EUR', dec: 2, group: false });
  expect(numFmtToStyle('0.00%')).toEqual({ fmt: 'percent', dec: 2, group: false });
  expect(numFmtToStyle('#,##0.00%')).toEqual({ fmt: 'percent', dec: 2 });
});
