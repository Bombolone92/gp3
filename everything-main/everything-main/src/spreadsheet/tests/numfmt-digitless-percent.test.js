import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';

it.each([
  [0.5, '"rate"%', 'rate%'],
  [0.5, '%', '%'],
  [-0.5, '"rate"%', '-rate%'], // a single section takes the automatic minus, as a digit section would
  [0.5, '"up"%;"down"%', 'up%'],
  [-0.5, '"up"%;"down"%', 'down%'],
  [0.5, '"a"%"b"', 'a%b'],
])('keeps the percent sign of the digitless section when %s is shown with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('still prints digitless sections without a percent sign as before', () => {
  expect(formatWithCode(5, '"hidden"')).toBe('hidden');
  expect(formatWithCode(5, '""')).toBe('');
  expect(formatWithCode(0.5, '0%')).toBe('50%');
});
