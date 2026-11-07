import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { formatValue, numFmtToStyle, styleToNumFmt } from '../src/core/format.js';

// Lowercase exponent markers are rejected instead of formatted.
it.each([
  [1234.5, '0.00e+00', '#####'],
  [1234.5, '0.00E+00', '1.23E+03'],
  [1234.5, '0.00e-00', '#####'],
  [0.00123, '0.00e-00', '#####'],
  [-1234.5, '0.0e+0', '#####'],
  [1234.5, '##0.0e+0', '#####'],
])('requires uppercase E for scientific %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('preserves an imported invalid code while reporting native overflow', () => {
  const style = numFmtToStyle('0.00e+00');
  expect(style).toEqual({ fmt: 'custom', code: '0.00e+00' });
  expect(styleToNumFmt(style)).toBe('0.00e+00');
  expect(formatValue(1234.5, style)).toBe('#####');
  expect(formatValue(1234.5, { fmt: 'scientific', dec: 2 })).toBe('1.23E+03');
});
