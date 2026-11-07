import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import oracle from './fixtures/reference-f-inverse-range.json';

it.each(oracle.cases)('resolves the full F inverse range: $expression', ({ expression, expected }) => {
  const actual = calc(expression);
  if (typeof expected !== 'number' || expected === 0) expect(actual).toEqual(expected);
  else expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-10);
  if (expression.startsWith('F.INV.RT(')) expect(calc(expression.replace('F.INV.RT', 'FINV'))).toEqual(actual);
});

it('uses either small tail without subtracting a computed near-one CDF', () => {
  for (const p of [0.9, 0.999999999, 0.999999999999999]) {
    const tail = 1 - p;
    expect(Math.abs(calc(`F.INV(${p},2,2)`) / (p / tail) - 1)).toBeLessThan(1e-13);
    expect(Math.abs(calc(`F.INV.RT(${p},2,2)`) / (tail / p) - 1)).toBeLessThan(1e-13);
  }
});

it('continues to the finite numeric limit and distinguishes true overflow', () => {
  for (const fn of ['F.INV.RT', 'FINV']) {
    expect(Math.abs(calc(`${fn}(EXP(-709.2),2,2)`) / Math.exp(709.2) - 1)).toBeLessThan(1e-13);
    expect(calc(`${fn}(EXP(-710),2,2)`)).toEqual({ error: '#NUM!' });
    expect(calc(`${fn}(1e-155,1,1)`)).toEqual({ error: '#NUM!' });
  }
  expect(calc('F.INV(1e-155,1,1)')).toBe(0);
  expect(calc('F.INV(EXP(-709),2,2)')).toBe(0);
});

it('keeps endpoint, degree truncation and invalid-input behavior', () => {
  expect(calc('F.INV(0,1,2)')).toBe(0);
  expect(calc('F.INV.RT(1,1,2)')).toBe(0);
  expect(calc('F.INV(1,1,2)')).toEqual({ error: '#NUM!' });
  expect(calc('F.INV.RT(0,1,2)')).toEqual({ error: '#NUM!' });
  for (const fn of ['F.INV', 'F.INV.RT', 'FINV']) {
    expect(calc(`${fn}(0.1,3.9,4.9)`)).toEqual(calc(`${fn}(0.1,3,4)`));
    expect(calc(`${fn}(0.1,0.9,4)`)).toEqual({ error: '#NUM!' });
  }
});
