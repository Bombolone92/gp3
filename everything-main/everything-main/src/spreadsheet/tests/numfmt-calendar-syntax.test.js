import { expect, it } from 'vitest';
import { formatCodeError, formatWithCode, codeDateKind } from '../src/core/numfmt.js';
import { calc } from './helpers/calc.js';

// All syntax outcomes verified with native Excel TEXT, including nonnumeric input.
it.each([
  'b0', 'b3', 'bb1', 'bbb2', 'yyyyb1', 'yyyyb2', 'db2',
  'b1b2yyyy', 'b2b1yyyy', '"x"b2yyyy', ' b2yyyy', '0b2', 'b2 0',
  'Generalb2', '@b2', 'h b2', '[h]b2', 'AM/PMb2', '\\b2yyyy',
  'y1', 'h2', '1yyyy', 'yyyy 2', 'b9', 'b1 0', 'b1#', 'b2?/?',
  'b2b1', 'b1b2', 'b2 b2yyyy', 'b2""b2yyyy', 'b2[Red]b2yyyy',
  'b1[Red]b1yyyy', 'b2[$-409]b2yyyy',
])('rejects invalid calendar syntax %s throughout the format', code => {
  expect(formatCodeError(code)).toBeTruthy();
  expect(codeDateKind(45000, code)).toBeNull();
  for (const value of ['0', '45000', '-1', '"label"', 'TRUE']) {
    expect(calc(`TEXT(${value},"${code.replaceAll('"','""')}")`)).toEqual({ error:'#VALUE!' });
  }
  expect(formatWithCode(5, `0;${code}`)).toBe('#####');
});

it.each([
  ['b1', ''], ['b2', ''], ['b1b1yyyy', '2023'], ['[Red]b1b1yyyy', '2023'],
  ['b1.000', '.679'], ['b1"x".000', 'x.679'],
  ['b1"2"yyyy', '22023'], ['b"2"yyyy', '6622023'],
  ['b2%', '%'], ['b2"x"', 'x'], ['b2[h]', '1080003'],
])('keeps valid selector and literal syntax in %s', (code, expected) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(45000 + 12345.6789 / 86400, code)).toBe(expected);
});

it('does not mistake quoted digits, numeric literals or numeric denominators for calendar syntax', () => {
  expect(formatWithCode(45000, 'yyyy" 2"')).toBe('2023 2');
  expect(formatWithCode(45000, 'yyyy\\2')).toBe('20232');
  expect(formatWithCode(1.5, '# ?/2')).toBe('1 1/2');
  expect(formatWithCode(5, '0"b2"')).toBe('5b2');
  expect(formatWithCode(5, 'b1General')).toBe('5');
  expect(formatWithCode(5, 'b2@')).toBe('5');
});
