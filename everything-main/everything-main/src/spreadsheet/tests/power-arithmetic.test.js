import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-power-arithmetic.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native power arithmetic: $expression', ({ expression, expected }) => {
  const actual = calc(expression);
  if (typeof expected !== 'number' || expected === 0) expect(actual).toEqual(expected);
  else expect(actual / expected).toBeCloseTo(1, 11);
});

it('takes the reciprocal after the positive power, preserving its underflow error', () => {
  expect(calc('POWER(1e-154,-2)')).toEqual({ error: '#DIV/0!' });
  expect(calc('(1e-154)^-2')).toEqual({ error: '#DIV/0!' });
  expect(calc('POWER(1e154,-3)')).toBe(0);
  expect(calc('POWER(1e154,3)')).toEqual({ error: '#NUM!' });
});

it('uses a raw square only for the operator, including referenced exponents', () => {
  expect(calc('A1^B1', { A1: '1e-154', B1: '2' })).toBe(1e-308);
  expect(calc('POWER(A1,B1)', { A1: '1e-154', B1: '2' })).toBe(0);
  expect(calc('POWER(1e-154,2.1)')).toBe(Number.MIN_VALUE);
  expect(calc('0.5^1023')).toBe(0);
});

it('bounds integer repeated squaring before the unsigned 32-bit sentinel', () => {
  expect(calc('POWER(-1,4294967294)')).toBe(1);
  expect(calc('POWER(-1,4294967295)')).toEqual({ error: '#NUM!' });
  expect(calc('POWER(1,4294967295)')).toBe(1);
  expect(calc('POWER(1+2^-52,2^53)')).toBeCloseTo(Math.exp(2), 13);
});

it('limits high-word zero checks to native power domains and unary negation', () => {
  expect(calc('-EXP(-712)')).toBe(Math.exp(-712));
  expect(calc('-EXP(-711)')).toBe(-Math.exp(-711));
  expect(calc('0-EXP(-712)')).toBe(-Math.exp(-712));
  expect(calc('EXP(-712)=0')).toBe(false);
  expect(calc('POWER(EXP(-712),0)')).toEqual({ error: '#NUM!' });
  expect(calc('POWER(0-EXP(-712),0)')).toBe(1);
  expect(calc('POWER(EXP(-712),0.1)')).toBe(Math.exp(-712));
  expect(calc('POWER(0-EXP(-712),0.1)')).toEqual({ error: '#NUM!' });
});
