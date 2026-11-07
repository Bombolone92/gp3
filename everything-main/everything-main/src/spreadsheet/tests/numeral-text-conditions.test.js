import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { matchesRule } from '../src/core/condformat.js';
import { checkValue } from '../src/core/validation.js';

// Text Number() would parse, which the formula engine and the filter's value list read as words.
const words = ['0x10', '0b11', '0o7', 'Infinity', '-Infinity'];

it.each(words)('treats the text %s as words, not as a number, in comparisons and date rules', (text) => {
  expect(matchesRule({ type: 'gt', value: 5 }, text)).toBe(false);
  expect(matchesRule({ type: 'lt', value: 1e9 }, text)).toBe(false);
  expect(matchesRule({ type: 'between', value: 0, value2: 1e9 }, text)).toBe(false);
  expect(matchesRule({ type: 'eq', value: 16 }, text)).toBe(false);
  expect(matchesRule({ type: 'date', value: 'future' }, text, { today: 45000 })).toBe(false);
  expect(matchesRule({ type: 'top', value: 1 }, text, { numbers: [1] })).toBe(false);
});

it('still reads a plain numeral typed as text, with a sign, decimals, an exponent, or spaces around it', () => {
  for (const text of ['12', ' 7 ', '-3.5', '+2', '.5', '1e3', '1E-2']) expect(matchesRule({ type: 'gt', value: -10 }, text)).toBe(true);
  expect(matchesRule({ type: 'eq', value: '1e3' }, 1000)).toBe(true);
  expect(matchesRule({ type: 'eq', value: ' 7 ' }, 7)).toBe(true);
  expect(matchesRule({ type: 'gt', value: 5 }, '1e999')).toBe(false);
});

it.each(words)('rejects %s for a number rule and does not read it as a number the list holds', (text) => {
  expect(checkValue({ type: 'number' }, text).ok).toBe(false);
  expect(checkValue({ type: 'number', min: 0 }, text).ok).toBe(false);
  expect(checkValue({ type: 'list', source: '16, 3, 7' }, text).ok).toBe(false);
  expect(checkValue({ type: 'list', source: `${text}, b` }, 16).ok).toBe(false);
});

it('accepts a plain numeral typed as text for a number rule and matches it to a number the list holds', () => {
  expect(checkValue({ type: 'number', min: 0, max: 20 }, ' 7 ').ok).toBe(true);
  expect(checkValue({ type: 'number' }, '1e3').ok).toBe(true);
  expect(checkValue({ type: 'list', source: '16, 3, 7' }, '7.0').ok).toBe(true);
  expect(checkValue({ type: 'list', source: '16, 3, 7' }, 7).ok).toBe(true);
});

it('keeps text that merely parses as a number out of a numeric filter condition', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ v: 'V' }, { v: 10 }, { v: '0x10' }, { v: 'Infinity' }, { v: 3 }].map((cell, r) => ({ r, c: 0, cell })));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
  wb.setFilterCriteria(id, 0, { op: 'gt', value: 5 });
  expect([...wb.sheet(id).filterHidden].sort((a, b) => a - b)).toEqual([2, 3, 4]);
});
