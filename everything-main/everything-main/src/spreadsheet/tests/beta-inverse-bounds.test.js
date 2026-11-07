import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import oracle from './fixtures/reference-beta-inverse-bounds.json';

it.each(oracle.cases)('preserves inverse beta bounds arithmetic: $expression', ({ expression, expected }) => {
  const actual = calc(expression);
  if (typeof expected !== 'number' || expected === 0) expect(actual).toEqual(expected);
  else expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-10);
});

it('flushes a scaled offset while retaining the lower bound in the final addition', () => {
  expect(calc('BETA.INV(0.25,0.5,1,1e-307,2e-307)')).toBe(1e-307);
  const formula = 'BETA.INV(0.25,1,1,EXP(-709),EXP(-708))';
  expect(calc(formula)).toBe(Math.exp(-709));
  expect(calc(`${formula}*1e307`)).toBe(Math.exp(-709) * 1e307);
  expect(calc('BETA.INV(0.25,1,1,-EXP(-709),EXP(-709))')).toBe(-Math.exp(-709));
  expect(calc('BETA.INV(0.25,1,1,0,EXP(-709))')).toBe(0);
});

it('retains exact symmetric medians before applying the bounds arithmetic', () => {
  for (const shape of [0.125, 0.75, 1, 3.5, 50, 10000]) {
    expect(calc(`BETA.INV(0.5,${shape},${shape})`)).toBe(0.5);
    expect(calc(`BETA.INV(0.5,${shape},${shape},-1e-307,1e-307)`)).toBe(0);
    expect(calc(`BETA.INV(0.5,${shape},${shape},-EXP(-709),EXP(-709))`)).toBe(-Math.exp(-709));
  }
});

it('rejects reversed and equal bounds in both inverse beta names', () => {
  for (const fn of ['BETA.INV', 'BETAINV']) for (const bounds of ['2,-2', '1,1', '0,-1', 'EXP(-708),EXP(-709)']) {
    expect(calc(`${fn}(0.25,2,3,${bounds})`)).toEqual({ error: '#NUM!' });
  }
});
