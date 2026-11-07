import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-aggregate-overflow.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native aggregate overflow: $expression', ({ formula, expected, cells }) => {
  const actual = calc(formula, cells);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Math.abs(Number(actual) - expected)).toBeLessThan(Math.abs(expected) * 1e-11);
});

it('retains intermediate overflow before cancellation or mean division', () => {
  expect(calc('SUM(9e307,9e307,-9e307)')).toEqual({ error: '#NUM!' });
  expect(calc('SUM(9e307,-9e307,9e307)')).toBe(9e307);
  expect(calc('AVERAGE(9e307,9e307)')).toEqual({ error: '#NUM!' });
  expect(calc('AVERAGE(8e307,8e307)')).toBe(8e307);
});

it('propagates selected input errors while excluding errors outside conditional aggregates', () => {
  const cells = { A1: '9e307', A2: '9e307', A3: '=NA()', B1: 'yes', B2: 'yes', B3: 'no' };
  expect(calc('SUM(A1:A3)', cells)).toEqual({ error: '#N/A' });
  expect(calc('AVERAGE(A1:A3)', cells)).toEqual({ error: '#N/A' });
  expect(calc('SUMIF(B1:B3,"yes",A1:A3)', cells)).toEqual({ error: '#NUM!' });
  expect(calc('AVERAGEIFS(A1:A3,B1:B3,"yes")', cells)).toEqual({ error: '#NUM!' });
});
