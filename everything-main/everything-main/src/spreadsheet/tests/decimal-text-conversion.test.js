import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { toNumber } from '../src/core/formula/functions.js';
import { getLocale, setLocale, parseInput } from '../src/core/format.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-decimal-text-conversion.json', import.meta.url), 'utf8'));
const originalLocale = getLocale();
afterEach(() => setLocale(originalLocale));

it.each(native.cases)('matches Excel decimal text conversion: $formula', ({ probe, expected }) => {
  expect(calc(probe)).toBe(expected);
});

it.each(native.criteriaCases)('matches Excel numeric criteria for $cell', ({ text, criterion, expected }) => {
  expect(calc(`COUNTIF(A1,${criterion})`, { A1: `'${text}` })).toBe(expected);
});

it('keeps conversion failure separate from arithmetic overflow and numeric inputs', () => {
  expect(toNumber('1e308')).toEqual({ error: '#VALUE!' });
  expect(toNumber(1e308)).toBe(1e308);
  expect(calc('(1e307*10)*10')).toEqual({ error: '#NUM!' });
  expect(calc('VALUE("1e309%")')).toBe(1e307);
  expect(calc('NUMBERVALUE("1e309%")')).toEqual({ error: '#VALUE!' });
  expect(calc('NUMBERVALUE("1e307"&REPT("%",155))')).toBe(0.001);
});

it('truncates significant digits without rounding away leading fractional zeros', () => {
  expect(toNumber('1.234567890123459')).toBe(1.23456789012345);
  expect(toNumber('-000.0001234567890123459')).toBe(-0.000123456789012345);
  expect(toNumber('9999999999999999')).toBe(9999999999999990);
  expect(toNumber('0e308')).toBe(0);
  expect(toNumber('0e309')).toEqual({ error: '#VALUE!' });
  expect(toNumber('0.0e309')).toBe(0);
  expect(toNumber('1e-309')).toBe(0);
  expect(toNumber('1e-310')).toEqual({ error: '#VALUE!' });
});

it('uses the same conversion after regional grouping, currency and percent parsing', () => {
  expect(toNumber('$1.234567890123459')).toBe(1.23456789012345);
  expect(toNumber('$1e308')).toEqual({ error: '#VALUE!' });
  setLocale('de-DE');
  expect(toNumber('1.234.567,890123456')).toBe(1234567.89012345);
  expect(toNumber('0,1e309%')).toBe(1e306);
  expect(toNumber('1,25 €')).toBe(1.25);
  expect(calc('NUMBERVALUE("1,25e308%",",",".")')).toEqual({ error: '#VALUE!' });
  // Cell-entry cleanup keeps its separate behavior; formula coercion must not
  // change the format parser's default policy or its output format selection.
  expect(parseInput('1.234.567,890123456').v).toBe(1234567.890123456);
  expect(parseInput('50%')).toMatchObject({ v: 0.5, fmt: 'percent' });
});
