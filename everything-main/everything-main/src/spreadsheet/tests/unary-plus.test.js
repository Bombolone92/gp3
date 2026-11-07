import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('leaves the operand of a unary plus alone', () => {
  expect(calc('+A1', { A1: 'abc' })).toBe('abc');
  expect(calc('+A1', { A1: 'TRUE' })).toBe(true);
  expect(calc('+5')).toBe(5);
  expect(calc('+A1*2', { A1: '4' })).toBe(8);
  expect(calc('+A1', { A1: '=1/0' })).toEqual({ error: '#DIV/0!' });
  expect(calc('SUM(+A1:A2)', { A1: '1', A2: '2' })).toBe(3);
});

it('keeps unary minus converting to a number', () => {
  expect(calc('-A1', { A1: '3' })).toBe(-3);
  expect(calc('-A1', { A1: 'abc' })).toEqual({ error: '#VALUE!' });
  expect(calc('-A1', { A1: 'TRUE' })).toBe(-1);
  expect(calc('-2^2')).toBe(4);
});
