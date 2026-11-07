import { expect, it } from 'vitest';
import { formatValue } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

it('rounds decimal halves away from zero in custom codes, like ROUND does', () => {
  expect(calc('TEXT(1.005,"0.00")')).toBe('1.01');
  expect(calc('TEXT(8.325,"0.00")')).toBe('8.33');
  expect(calc('TEXT(0.285,"0.00")')).toBe('0.29');
  expect(calc('TEXT(-1.005,"0.00")')).toBe('-1.01');
  expect(calc('TEXT(2.5,"0")')).toBe('3');
  expect(calc('TEXT(-2.5,"0")')).toBe('-3');
  expect(calc('TEXT(1234.5678,"#,##0.00")')).toBe('1,234.57');
  expect(calc('TEXT(8.325,"0.00")')).toBe(calc('FIXED(8.325,2)'));
  expect(formatValue(8.325, { fmt: 'custom', code: '0.00' })).toBe('8.33');
  expect(formatValue(8.325, { fmt: 'number', dec: 2 })).toBe('8.33');
});

it('leaves values that are not halves alone', () => {
  expect(calc('TEXT(1.004,"0.00")')).toBe('1.00');
  expect(calc('TEXT(1.006,"0.00")')).toBe('1.01');
  expect(calc('TEXT(12345,"0.00")')).toBe('12345.00');
  expect(calc('TEXT(0.1+0.2,"0.0")')).toBe('0.3');
});
