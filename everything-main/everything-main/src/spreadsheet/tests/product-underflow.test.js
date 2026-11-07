import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc, calcValues } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-product-underflow.json', import.meta.url), 'utf8'));

it.each(native.cases)('matches native product accumulation: $expression', ({formula,cells,expected}) => {
  expect(calc(formula,cells)).toBe(expected);
});

it('underflows at each actual multiplication while preserving the first numeric input', () => {
  const tiny = Math.exp(-710);
  for (const name of ['PRODUCT','SUMPRODUCT']) {
    expect(calc(`${name}(EXP(-710))`)).toBe(tiny);
    expect(calc(`${name}(EXP(-710),1)`)).toBe(0);
    expect(calc(`${name}(EXP(-710),1e307)`)).toBe(tiny * 1e307);
    expect(calc(`${name}(1e-154,1e-154,1e307)`)).toBe(0);
    expect(calc(`${name}(1e307,1e-154,1e-154)`)).toBe(1e307 * 1e-154 * 1e-154);
    expect(calcValues(`${name}(A1)`, {A1:tiny})).toBe(tiny);
  }
});

it('flushes individual squared products before adding, including normal totals', () => {
  expect(calc('SUMSQ(1e-154,1e-154,1e-154)')).toBe(0);
  expect(calc('SUMPRODUCT({1e-154,1e-154,1e-154},{1e-154,1e-154,1e-154})')).toBe(0);
  expect(calc('SUMSQ(1e-154,2)')).toBe(4);
  expect(calc('SUMPRODUCT({1e-154,2},{1e-154,3})')).toBe(6);
  expect(calc('SUMSQ(1.5e-154)')).toBe(1.5e-154 * 1.5e-154);
});

it('preserves coercion, ignored cells, empty aggregates, errors and overflow order', () => {
  expect(calc('PRODUCT(A1:A3)', {A1:'text',A2:'=EXP(-710)',A3:'TRUE'})).toBe(Math.exp(-710));
  expect(calc('PRODUCT(A1:A3)')).toBe(0);
  expect(calc('SUMSQ(A1:A3)')).toBe(0);
  expect(calc('PRODUCT(TRUE,"2",1e-307,0.1)')).toBe(0);
  expect(calc('PRODUCT(1e-154,1e-154,NA())')).toEqual({error:'#N/A'});
  expect(calc('SUMPRODUCT({1e-154,1},{1e-154,#N/A})')).toEqual({error:'#N/A'});
  expect(calc('PRODUCT(1e307,100,0)')).toEqual({error:'#NUM!'});
  expect(calc('PRODUCT(1e307,0,100)')).toBe(0);
  expect(calc('SUMPRODUCT({1,2},{1})')).toEqual({error:'#VALUE!'});
});

it('retains native sum overflow even when finite product terms later cancel', () => {
  expect(calc('SUMPRODUCT({1e307,1e307,-1e307,-1e307},{10,10,10,10})')).toEqual({ error: '#NUM!' });
  expect(calc('SUMPRODUCT({1e307,1e307,-1e307,-1e307,1e-307},{10,10,10,10,0.1})')).toEqual({ error: '#NUM!' });
});
