import { expect, it } from 'vitest';
import { formatValue, ymdToSerial } from '../src/core/format.js';

it.each([
  { fmt: 'date' }, { fmt: 'date', dateStyle: 'long' },
  { fmt: 'custom', code: 'mmm d, yyyy' }, { fmt: 'custom', code: 'dddd' },
])('shows a marker for out-of-range dates in %j', (style) => {
  expect(formatValue(1e100, style)).toBe('#####');
  expect(formatValue(ymdToSerial(10000, 1, 1), style)).toBe('#####');
  expect(formatValue(ymdToSerial(9999, 12, 31), style)).not.toBe('#####');
});

it('bounds clock remainders but permits pure elapsed totals beyond the calendar', () => {
  expect(formatValue(4000000, { fmt: 'custom', code: '[h]:mm' })).toBe('#####');
  expect(formatValue(4000000, { fmt: 'custom', code: '[h]' })).toBe('96000000');
});
