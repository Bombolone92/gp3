import { expect, it } from 'vitest';
import { formatCodeError, formatWithCode } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';

// Digit placeholders mixed with unquoted date letters are rejected.
it.each([
  [5, '0 days'], [5, '0 hrs'], [5, '0 Days'], [-5, '0 days'],
  [12345, '#,##0 sec'], [1.5, '0.0 m'], [1.5, '0.0 ms'], [1.5, '0.0 yd'],
  [5, 'day 0'], [2.75, '# ?/? h'], [0.5, '0% share'], [5, '0 [h]'],
])('rejects unquoted date fields mixed with digits for %s in %s', (value, code) => {
  expect(formatCodeError(code)).toBeTruthy();
  expect(formatWithCode(value, code)).toBe('#####');
  expect(formatValue(value, { fmt: 'custom', code })).toBe('#####');
});

it.each([
  [5, '0 "days"', '5 days'], [1.5, '0.0 "m"', '1.5 m'],
  [12345, '#,##0 "sec"', '12,345 sec'], [2.75, '# ?/? "h"', '2 3/4 h'],
  [5, '0 "[h]"', '5 [h]'],
])('prints explicitly quoted unit labels for %s in %s', (value, code, display) => {
  expect(formatWithCode(value, code)).toBe(display);
});

it('still reads letters as date fields in a section without digit placeholders', () => {
  expect(formatWithCode(45306.5, 'd mmm yyyy h:mm')).toBe('15 Jan 2024 12:00');
  expect(formatWithCode(45306.5, 'dddd')).toBe('Monday');
  expect(formatWithCode(1.5, '[h]:mm')).toBe('36:00');
  expect(formatWithCode(0.5, 'h AM/PM')).toBe('12 PM');
});

// Numeric placeholders may precede meridiem fields, independently of date letters.
it('renders a meridiem field after numeric placeholders', () => {
  expect(formatWithCode(5, '0 AM/PM')).toBe('5 AM');
});
