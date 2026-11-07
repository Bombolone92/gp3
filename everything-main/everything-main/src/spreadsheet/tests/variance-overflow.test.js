import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-variance-overflow.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native descriptive-statistic overflow: $expression', ({ formula, cells, expected }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('retains raw-square and squared-sum overflow even for finite centered deviations', () => {
  expect(calc('VAR.S({0,1.5e154})')).toEqual({ error: '#NUM!' });
  expect(calc('VAR.S({7e153,7e153})')).toEqual({ error: '#NUM!' });
  expect(calc('VAR.S({6e153,6e153})')).toBe(0);
  expect(calc('DEVSQ({0,1.5e154})') / 1e308).toBeCloseTo(1.125, 13);
  expect(calc('VAR.S({-7.5e153,7.5e153})') / 1e308).toBeCloseTo(1.125, 13);
});

it('includes the population count in the raw-moment overflow check', () => {
  expect(calc('VAR.S({0,0,8e153})') / 1e307).toBeCloseTo(6.4 / 3, 13);
  expect(calc('VAR.P({0,0,8e153})')).toEqual({ error: '#NUM!' });
  expect(calc('VAR.P({0,0,7e153})') / 1e307).toBeCloseTo(9.8 / 9, 13);
  expect(calc('VARPA({0,8e153,FALSE})') / 1e307).toBeCloseTo(1.6, 13);
  expect(calc('VARPA(0,8e153,FALSE)')).toEqual({ error: '#NUM!' });
});

it('keeps database sample-count priority distinct from ordinary variance functions', () => {
  const cells = { A1: 'Value', A2: '1.5e154', C1: 'Value', C2: '<>' };
  for (const fn of ['VAR.S', 'STDEV.S', 'VARA', 'STDEVA']) expect(calc(`${fn}(A2)`, cells)).toEqual({ error: '#NUM!' });
  for (const fn of ['DVAR', 'DSTDEV']) expect(calc(`${fn}(A1:A2,"Value",C1:C2)`, cells)).toEqual({ error: '#DIV/0!' });
  for (const fn of ['DVARP', 'DSTDEVP']) expect(calc(`${fn}(A1:A2,"Value",C1:C2)`, cells)).toEqual({ error: '#NUM!' });
  expect(calc('VAR.S(1)')).toEqual({ error: '#DIV/0!' });
  expect(calc('VAR.P(A1:A2)')).toEqual({ error: '#DIV/0!' });
  expect(calc('VAR.S(1.5e154,NA())')).toEqual({ error: '#N/A' });
});

it('leaves centered higher-moment and paired-test calculations independent of public variance overflow', () => {
  expect(calc('SKEW.P({0,0,8e153})')).toBeCloseTo(Math.SQRT1_2, 13);
  expect(calc('SKEW({0,0,8e153})')).toBeCloseTo(Math.sqrt(3), 13);
  expect(calc('T.TEST({0,1e154,0},{1e154,0,1e154},2,1)')).toBeCloseTo(2 / 3, 13);
});
