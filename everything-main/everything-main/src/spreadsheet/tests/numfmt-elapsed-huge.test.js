import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';

it('writes an elapsed time past 1e21 units in full digits, not in exponent notation', () => {
  expect(formatWithCode(1e22, '[h]')).toBe('240000000000000000000000');
  expect(formatWithCode(1e22, '[mm]')).toBe('14400000000000000000000000');
  expect(formatWithCode(1e22, '[s]')).toBe('864000000000000000000000000');
  // From 1e15 on the fifteen significant digits kept, then zeros, as the fixed formats print integers.
  expect(formatWithCode(2 ** 60 / 24, '[h]')).toBe('1152921504606850000');
  expect(formatWithCode(1e15, '[h]')).toBe('24000000000000000');
  // Ordinary elapsed times as before.
  expect(formatWithCode(1.5, '[h]:mm')).toBe('36:00');
  expect(formatWithCode(1e6, '[h]')).toBe('24000000');
});
