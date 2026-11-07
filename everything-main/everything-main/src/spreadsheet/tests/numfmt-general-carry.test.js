import { afterEach, expect, it } from 'vitest';
import { formatGeneral, formatValue, setLocale } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

it.each([
  [999999999999999.5, '1E+15'],
  [999999999999999.9, '1E+15'],
  [-999999999999999.5, '-1E+15'],
  [1e15, '1E+15'],
  [999999999999999.4, '1E+15'],
  [999999999999999, '1E+15'],
  [123456789012345.6, '1.23457E+14'],
  [99999999999.99999, '1E+11'],
])('shows %s in General as %s, carrying through fixed and scientific display limits', (value, expected) => {
  expect(formatGeneral(value)).toBe(expected);
  expect(formatValue(value, { fmt: 'general' })).toBe(expected);
});

it('uses the locale decimal mark in the carried E notation', () => {
  setLocale('de-DE');
  expect(formatGeneral(999999999999999.5)).toBe('1E+15');
  expect(formatGeneral(1234567890123456)).toBe('1,23457E+15');
});
