import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { editText, formatGeneral, formatNumberText, getLocale, parseInput, setLocale } from '../src/core/format.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-number-text-conversion.json', import.meta.url),'utf8'));
const locale = getLocale();
afterEach(() => setLocale(locale));

it.each(native.cases)('matches native text conversion: $formula', ({formula,expected}) => {
  expect(calc(formula)).toBe(expected);
});

it('uses the unsigned decimal width and reserves space for exponent carries', () => {
  expect(formatNumberText(1e-18)).toBe('0.000000000000000001');
  expect(formatNumberText(-1e-18)).toBe('-0.000000000000000001');
  expect(formatNumberText(1.2e-18)).toBe('1.2E-18');
  expect(formatNumberText(1.23456789012345e19)).toBe('12345678901234500000');
  expect(formatNumberText(1e20)).toBe('1E+20');
  expect(formatNumberText(1.23456789012345e99)).toBe('1.2345678901235E+99');
  expect(formatNumberText(9.99999999999999e99)).toBe('1E+100');
  expect(formatNumberText(Number.MAX_VALUE)).toBe('1.7976931348623E+308');
  expect(formatNumberText(-Number.MIN_VALUE)).toBe('-0');
  expect(formatNumberText(-0)).toBe('0');
});

it('localizes conversion without changing display or editing precision', () => {
  expect(formatGeneral(1 / 3)).toBe('0.333333333');
  expect(formatNumberText(1 / 3)).toBe('0.333333333333333');
  expect(editText({v:1e15})).toBe('1E+15');
  expect(parseInput(editText({v:Number.MAX_VALUE})).v).toBe(Number.MAX_VALUE);
  expect(parseInput(editText({v:Number.MIN_VALUE})).v).toBe(Number.MIN_VALUE);
  setLocale('de-DE');
  expect(calc('1e-7&""')).toBe('0,0000001');
  expect(calc('1.23456789012345e-5&""')).toBe('1,23456789012345E-05');
  expect(calc('VALUETOTEXT(1/3)')).toBe('0,333333333333333');
});

it('retains the established strict quoting, errors and text-length limits', () => {
  expect(calc('ARRAYTOTEXT({1e15,"quoted";TRUE,1e-7},1)')).toBe('{1000000000000000,"quoted";TRUE,0.0000001}');
  expect(calc('VALUETOTEXT(NA(),1)')).toBe('#N/A');
  expect(calc('ARRAYTOTEXT(SEQUENCE(2000,,1e19,0))')).toEqual({error:'#VALUE!'});
  expect(calc('TEXTJOIN("",TRUE,SEQUENCE(2000,,1e19,0))')).toEqual({error:'#VALUE!'});
});
