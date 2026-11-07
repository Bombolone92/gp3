import { expect, it } from 'vitest';
import { editText, parseInput } from '../src/core/format.js';

it('shows numbers for editing with 15 significant digits', () => {
  expect(editText({ v: 1 / 3 })).toBe('0.333333333333333');
  expect(editText({ v: 0.1 + 0.2 })).toBe('0.3');
  expect(editText({ v: 99999999999.99 })).toBe('99999999999.99');
  expect(editText({ v: 1e21 })).toBe('1E+21');
  expect(editText({ v: 0.12345, s: { fmt: 'percent' } })).toBe('12.345%');
  expect(editText({ v: 1 / 3, s: { fmt: 'percent' } })).toBe('33.3333333333333%');
});

it('round-trips a value through an edit without losing more than the 15th digit', () => {
  for (const v of [1 / 3, 2 / 7, 123456.789012345, 1e21, 0.000012345]) {
    const back = parseInput(editText({ v })).v;
    expect(Math.abs(back - v) <= Math.abs(v) * 1e-14).toBe(true);
  }
});
