import { expect, it } from 'vitest';
import { formatGeneral } from '../src/core/format.js';

it('rounds large values to the General display width', () => {
  expect(formatGeneral(12345678901.5)).toBe('12345678902');
  expect(formatGeneral(99999999999.99)).toBe('1E+11');
  expect(formatGeneral(-12345678901.5)).toBe('-12345678902');
  expect(formatGeneral(123456789012345.6)).toBe('1.23457E+14');
  expect(formatGeneral(12345678901234.56)).toBe('1.23457E+13');
});

it('counts the leading zero and decimal point toward the display width', () => {
  expect(formatGeneral(1234567.123456789)).toBe('1234567.123');
  expect(formatGeneral(0.1 + 0.2)).toBe('0.3');
  expect(formatGeneral(1 / 3)).toBe('0.333333333');
  expect(formatGeneral(1e15)).toBe('1E+15');
  expect(formatGeneral(123456)).toBe('123456');
});
