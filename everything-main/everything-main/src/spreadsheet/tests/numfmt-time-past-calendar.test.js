import { expect, it } from 'vitest';
import { formatValue, formatTime, CALENDAR_END, ymdToSerial } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';

it('ends the calendar the day after 9999-12-31', () => {
  expect(CALENDAR_END).toBe(2958466);
  expect(CALENDAR_END).toBe(ymdToSerial(9999, 12, 31) + 1);
});

it.each([
  [1e10, { fmt: 'time' }],
  [1e10, { fmt: 'time', sec: true }],
  [CALENDAR_END, { fmt: 'time' }],
  [1e100, { fmt: 'time' }],
  [1e10, { fmt: 'custom', code: 'h:mm' }],
  [1e10, { fmt: 'custom', code: 'hh:mm:ss AM/PM' }],
  [1e10, { fmt: 'custom', code: 'mm:ss.0' }],
  [1e10, { fmt: 'datetime' }],
])('shows the marker for the serial %s past the calendar in %j', (value, style) => {
  expect(formatValue(value, style)).toBe('#####');
});

it('keeps clock readings up to the last day and elapsed durations beyond it', () => {
  expect(formatValue(CALENDAR_END - 0.5, { fmt: 'time' })).toBe('12:00');
  expect(formatTime(CALENDAR_END - 0.5, true)).toBe('12:00:00');
  expect(formatWithCode(CALENDAR_END - 0.5, 'h:mm AM/PM')).toBe('12:00 PM');
  expect(formatWithCode(1e10, '[h]:mm')).toBe('#####');
  expect(formatWithCode(4000000, '[h]:mm:ss')).toBe('#####');
  expect(formatWithCode(4000000.5, '[m]')).toBe('5760000720');
  expect(formatValue(0.75, { fmt: 'time' })).toBe('18:00');
});
