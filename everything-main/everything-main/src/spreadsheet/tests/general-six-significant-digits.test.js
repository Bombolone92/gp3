import { afterEach, describe, expect, it } from 'vitest';
import { formatGeneral, formatValue, formatNumberText, setLocale } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

afterEach(() => setLocale('en-US'));

// General printed seven significant digits in its E form (1.234568E+15) where General, capped at eleven
// characters, should print six (1.23457E+15).
describe('the E form of the General format', () => {
  it.each([
    [1234567890123456, '1.23457E+15'],
    [0.000000123456789, '1.23457E-07'],
    [1.23456789e20, '1.23457E+20'],
    [5e-324, '4.9407E-324'],
    [-1234567890123456, '-1.23457E+15'],
    [1.999999e15, '2E+15'], // the sixth digit rounds the fifth up
    [1e15, '1E+15'],
    [1.5e-8, '0.000000015'],
    [2.5e300, '2.5E+300'],
    [1e21, '1E+21'],
  ])('shows %s as %s, six significant digits at most', (value, expected) => {
    expect(formatGeneral(value)).toBe(expected);
    expect(formatValue(value, {})).toBe(expected);
    expect(formatValue(value, { fmt: 'general' })).toBe(expected);
    expect(expected.replace('-', '').length).toBeLessThanOrEqual(11);
  });

  it('is what TEXT with General and the regional decimal mark print too', () => {
    expect(calc('TEXT(1234567890123456,"General")')).toBe('1.23457E+15');
    setLocale('de-DE');
    expect(formatGeneral(1234567890123456)).toBe('1,23457E+15');
    expect(formatGeneral(0.000000123456789)).toBe('1,23457E-07');
  });

  it('leaves the fifteen digits a formula keeps when it turns a number into text', () => {
    expect(formatNumberText(1234567890123456)).toBe('1234567890123460');
    expect(formatNumberText(0.000000123456789)).toBe('0.000000123456789');
  });

  it('switches twelve-digit integers to scientific and keeps short decimals fixed', () => {
    expect(formatGeneral(123456789012)).toBe('1.23457E+11');
    expect(formatGeneral(1234.56789)).toBe('1234.56789');
    expect(formatGeneral(0.000001)).toBe('0.000001');
    expect(formatGeneral(999999999999999.5)).toBe('1E+15');
  });
});
