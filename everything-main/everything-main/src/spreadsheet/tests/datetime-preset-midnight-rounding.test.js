import { expect, it } from 'vitest';
import { formatValue, ymdToSerial } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';

const day = ymdToSerial(2024, 1, 15);

it.each([
  [day + 0.99999, { fmt: 'datetime' }, '2024-01-15 23:59'],
  [day + 86399.6 / 86400, { fmt: 'datetime', sec: true }, '2024-01-16 00:00:00'],
  [day + 0.99999, { fmt: 'datetime', sec: true }, '2024-01-15 23:59:59'],
  [day + 86369.5 / 86400, { fmt: 'datetime' }, '2024-01-15 23:59'],
  [day + 86399.6 / 86400, { fmt: 'datetime', dateStyle: 'medium' }, 'Jan 16, 2024 00:00'],
  [ymdToSerial(2024, 12, 31) + 86399.6 / 86400, { fmt: 'datetime' }, '2025-01-01 00:00'],
  [ymdToSerial(2024, 2, 28) + 86399.6 / 86400, { fmt: 'datetime' }, '2024-02-29 00:00'],
  [day + 0.5, { fmt: 'datetime' }, '2024-01-15 12:00'],
  [day, { fmt: 'datetime', sec: true }, '2024-01-15 00:00:00'],
])('carries a time that rounds up to midnight into the next day for %s', (value, style, expected) => {
  expect(formatValue(value, style)).toBe(expected);
});

it('agrees with the equivalent custom code', () => {
  for (const value of [day + 0.99999, day + 86399.6 / 86400, day + 0.5, day + 86369.5 / 86400]) {
    expect(formatValue(value, { fmt: 'datetime' })).toBe(formatWithCode(value, 'yyyy-mm-dd hh:mm'));
    expect(formatValue(value, { fmt: 'datetime', sec: true })).toBe(formatWithCode(value, 'yyyy-mm-dd hh:mm:ss'));
  }
});

it('shows ##### when the rounded time leaves the calendar', () => {
  expect(formatValue(2958465.9999, { fmt: 'datetime' })).toBe('9999-12-31 23:59');
  expect(formatValue(2958465 + 86399.6 / 86400, { fmt: 'datetime', sec: true })).toBe('#####');
  expect(formatValue(2958465.9999, { fmt: 'datetime', sec: true })).toBe('9999-12-31 23:59:51');
  expect(formatValue(2958465.5, { fmt: 'datetime' })).toBe('9999-12-31 12:00');
  expect(formatValue(-1, { fmt: 'datetime' })).toBe('#####');
});
