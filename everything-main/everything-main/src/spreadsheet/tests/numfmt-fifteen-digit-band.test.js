import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

it.each([
  [2 ** 60, '0', '1152921504606850000'],
  [-(2 ** 60), '0', '-1152921504606850000'],
  [1e17 / 3, '0', '33333333333333300'],
  [1e17 / 3, '#,##0.00', '33,333,333,333,333,300.00'],
  [1234567890123456.5, '0.0', '1234567890123460.0'],
  [999999999999999.9, '0', '1000000000000000'],
  [1e15, '0', '1000000000000000'],
  [1e15 + 1, '0', '1000000000000000'],
  [123456789012345.67, '0.00', '123456789012346.00'],
  [1e20, '0.00', '100000000000000000000.00'],
  [1e21, '0', '1000000000000000000000'],
])('prints %s with %s to fifteen significant digits, then zeros', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(formatValue(value, { fmt: 'custom', code })).toBe(expected);
});

it('gives TEXT the digits the number turns into as text', () => {
  expect(calc('TEXT(2^60,"0")')).toBe('1152921504606850000');
  expect(calc('2^60&""')).toBe('1152921504606850000'); // the rounded integer fits the native twenty-character field
  expect(calc('TEXT(1E17/3,"0")')).toBe('33333333333333300');
  expect(calc('TEXT(1E17/3,"#,##0")')).toBe('33,333,333,333,333,300');
});
