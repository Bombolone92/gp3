import { expect, it } from 'vitest';
import { calc, calcValues } from './helpers/calc.js';

it('turns numbers into text with 15 significant digits', () => {
  expect(calc('1/3&""')).toBe('0.333333333333333');
  expect(calc('123456789.123456789&""')).toBe('123456789.123456');
  expect(calcValues('A1&""', {A1:123456789.123456789})).toBe('123456789.123457');
  expect(calc('CONCAT("id-",A1)', { A1: '1234567890123' })).toBe('id-1234567890123');
  expect(calc('TEXTJOIN(",",TRUE,1/3,2)')).toBe('0.333333333333333,2');
  expect(calc('100&""')).toBe('100');
  expect(calc('-1.5&""')).toBe('-1.5');
  expect(calc('0.1+0.2&""')).toBe('0.3');
});

it('writes large numbers in E notation as 1E+21', () => {
  expect(calc('1E+21&""')).toBe('1E+21');
  expect(calc('100000000000000000000&""')).toBe('1E+20'); // fixed decimal text would exceed twenty characters
  expect(calc('0.0000001&""')).toBe('0.0000001');
  expect(calc('0.000001&""')).toBe('0.000001');
  expect(calc('1.5E-30&""')).toBe('1.5E-30');
});
