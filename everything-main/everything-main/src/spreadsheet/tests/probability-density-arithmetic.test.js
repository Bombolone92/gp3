import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-probability-density-arithmetic.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native density arithmetic: $expression', ({ formula, expected }) => {
  const actual = calc(formula);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('retains density precision when gamma logarithms would nearly cancel', () => {
  expect(calc('BETA.DIST(0.5,500000,500000,FALSE)') / 797.88436133175).toBeCloseTo(1, 13);
  expect(calc('T.DIST(0,1e10,FALSE)')).toBeCloseTo(0.39894228039146, 14);
  expect(calc('T.DIST(1.96,1e10,FALSE)')).toBeCloseTo(0.0584409443423267, 14);
  expect(calc('BETA.DIST(0.00089638199661675,100,0.5,TRUE)') / 1.0008927407759e-306).toBeCloseTo(1, 12);
});

it('checks native beta power errors against the original input before custom bounds', () => {
  for (const f of ['BETA.DIST(0,1,1,FALSE)', 'BETA.DIST(1,2,1,FALSE,0,2)',
    'BETA.DIST(0,0.5,2,FALSE,-3,7)', 'BETA.DIST(1,2,0.5,FALSE,-3,7)']) {
    expect(calc(f)).toEqual({ error: '#NUM!' });
  }
  expect(calc('BETA.DIST(-3,0.5,0.5,FALSE,-3,7)')).toBe(0);
  expect(calc('BETA.DIST(7,1,1,FALSE,-3,7)')).toBe(0);
  expect(calc('BETA.DIST(0,2,1,FALSE,-3,7)')).toBeCloseTo(0.06, 14);
  expect(calc('BETA.DIST(0,1,1,TRUE,-3,7)')).toBeCloseTo(0.3, 14);
});

it('flushes beta density before interval scaling and again after division', () => {
  expect(calc('BETA.DIST(5e-155*1e-10,3,1,FALSE,0,1e-10)')).toBe(0);
  expect(calc('BETA.DIST(1e-154*1e10,3,1,FALSE,0,1e10)')).toBe(0);
  expect(calc('BETA.DIST(1e-154*1e-10,3,1,FALSE,0,1e-10)') / 3e-298).toBeCloseTo(1, 12);
});
