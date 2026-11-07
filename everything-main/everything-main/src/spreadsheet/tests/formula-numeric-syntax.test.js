import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { parseInput, parseFormulaNumber, setLocale } from '../src/core/format.js';
import { toNumber } from '../src/core/formula/functions.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-formula-numeric-syntax.json', import.meta.url), 'utf8'));
afterEach(() => setLocale('en-US'));

it.each(native.cases)('reads formula numeric syntax as Excel does: $text', ({ text, values }) => {
  const literal = `"${text.replace(/"/g, '""')}"`;
  const expressions = [`VALUE(${literal})`, `${literal}+0`, `--${literal}`, `SUM(${literal})`, `ABS(${literal})`];
  for (const [i, expression] of expressions.entries()) {
    const expected = values[i], actual = calc(expression);
    if (typeof expected === 'string') expect(actual, expression).toEqual({ error: '#VALUE!' });
    else if (actual !== expected) {
      // Mixed-fraction percent conversion may differ by binary64 roundoff.
      // Keep the native value in the fixture instead of rounding the parser to
      // satisfy a particular spelling; numeric comparison uses 15 digits.
      expect(typeof actual, expression).toBe('number');
      expect(Math.abs(actual - expected), expression).toBeLessThanOrEqual(Math.abs(expected) * Number.EPSILON);
    }
  }
});

it.each([
  ['en-US', '$1,234.5', '1,234.5$', 'USD1,234.5'],
  ['en-GB', '£1,234.5', '1,234.5£', '$1,234.5'],
  ['en-AU', '$1,234.5', '1,234.5$', 'AUD1,234.5'],
  ['en-IN', '₹1,234.5', '1,234.5₹', 'INR1,234.5'],
  ['ja-JP', '￥1,234.5', '1,234.5￥', '$1,234.5'],
  ['sv-SE', '1 234,5 kr', 'kr1 234,5', '$1 234,5'],
])('uses the regional symbol and position in %s', (locale, accepted, reversed, foreign) => {
  setLocale(locale);
  expect(toNumber(accepted)).toBe(1234.5);
  for (const text of [reversed, foreign]) expect(toNumber(text)).toEqual({ error: '#VALUE!' });
});

it('accepts euro on either side and keeps decimal conversion before percent scaling', () => {
  for (const locale of ['en-US', 'en-GB', 'en-AU']) {
    setLocale(locale);
    expect(toNumber('€1,234.5')).toBe(1234.5);
    expect(toNumber('1,234.5€')).toBe(1234.5);
  }
  setLocale('de-DE');
  expect(toNumber('€1.234,5')).toBe(1234.5);
  expect(toNumber('1.234,5€')).toBe(1234.5);
  expect(toNumber('(0,1e309%)')).toBe(-1e306);
  expect(toNumber('€1,234567890123459')).toBe(1.23456789012345);
  expect(parseFormulaNumber('(50%)')).toBe(-0.5);
});

it('keeps friendly cell entry separate from formula coercion', () => {
  for (const text of ['USD 1', '1$', '£1', '€\u00a01', '(+1)', '−1', '1  1/2']) {
    expect(typeof parseInput(text).v, text).toBe('number');
    expect(toNumber(text), text).toEqual({ error: '#VALUE!' });
  }
  expect(parseInput('$1.234567890123459').v).toBe(1.234567890123459);
  expect(toNumber('$1.234567890123459')).toBe(1.23456789012345);
  expect(toNumber('2024-01-15')).toBe(45306);
  expect(toNumber('Jan-2024')).toBe(45292);
  expect(toNumber('25:30')).toBe(25.5 / 24);
  expect(toNumber('3 pm')).toBe(0.625);
});

it.each(['en-US', 'en-GB', 'en-AU', 'en-IN', 'de-DE', 'fr-FR', 'sv-SE', 'ja-JP'])('DOLLAR uses the regional currency and survives VALUE in %s', locale => {
  setLocale(locale);
  const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency: ({ 'en-US': 'USD', 'en-GB': 'GBP', 'en-AU': 'AUD', 'en-IN': 'INR', 'de-DE': 'EUR', 'fr-FR': 'EUR', 'sv-SE': 'SEK', 'ja-JP': 'JPY' })[locale] }).formatToParts(1).find(p => p.type === 'currency').value;
  expect(calc('DOLLAR(1234.5)')).toContain(symbol);
  for (const value of [1234.5, -1234.5, 0]) expect(calc(`VALUE(DOLLAR(${value}))`)).toBe(value);
});
