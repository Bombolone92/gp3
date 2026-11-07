import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
const native=JSON.parse(readFileSync(new URL('./fixtures/reference-t-cauchy-quantiles.json',import.meta.url),'utf8'));
it.each(native.cases)('matches native Cauchy quantile arithmetic: $expression', ({formula,expected}) => {
  const actual=calc(formula);
  expect(typeof actual).toBe('string');expect(actual).not.toBe('');
  if(typeof expected==='string')expect(actual).toBe(expected);
  else if(expected===0)expect(Number(actual)).toBe(0);
  else expect(Math.abs(Number(actual)/expected-1)).toBeLessThan(1e-11);
});

it('retains representable Cauchy quantiles beyond the squared-tail overflow boundary', () => {
  expect(calc('T.INV(1e-300,1)')/(-1/(Math.PI*1e-300))).toBeCloseTo(1,14);
  expect(calc('T.INV.2T(1e-300,1)')/(2/(Math.PI*1e-300))).toBeCloseTo(1,14);
  expect(calc('TINV(A1,1.9)',{A1:'1e-300'})).toBe(calc('T.INV.2T(1e-300,1)'));
});

it('flushes the angle after multiplication while flushing two-tail division before it', () => {
  expect(calc('T.INV(EXP(-709),1)')/(-1/(Math.PI*Math.exp(-709)))).toBeCloseTo(1,13);
  expect(calc('T.INV(EXP(-710),1)')).toEqual({error:'#DIV/0!'});
  expect(calc('T.INV.2T(EXP(-709),1)')).toEqual({error:'#DIV/0!'});
  expect(calc('T.INV.2T(2^-1021,1)')).toBeGreaterThan(1e307);
  expect(calc('T.INV.2T(2^-1021*(1-2^-50),1)')).toEqual({error:'#DIV/0!'});
  expect(calc('T.INV.2T(2^-1022,2)')).toEqual({error:'#NUM!'});
  expect(calc('CONFIDENCE.T(2^-1022,1,2)')).toEqual({error:'#NUM!'});
});

it('preserves native zero-probability errors without changing other domain checks', () => {
  for(const fn of ['T.INV','T.INV.2T','TINV']) {
    expect(calc(`${fn}(0,1)`)).toEqual({error:'#DIV/0!'});
    expect(calc(`${fn}(0,2)`)).toEqual({error:'#NUM!'});
    expect(calc(`${fn}(-0.01,1)`)).toEqual({error:'#NUM!'});
    expect(calc(`${fn}(0,0)`)).toEqual({error:'#NUM!'});
  }
  expect(calc('T.INV(0.5,1)')).toBe(0);
  expect(calc('T.INV.2T(1,1)')).toBe(0);
  expect(calc('CONFIDENCE.T(0,1,2)')).toEqual({error:'#NUM!'});
});

it('uses the direct cotangent arithmetic near the median and in two-sample confidence intervals', () => {
  expect(calc('T.INV(0.5+2^-52,1)')).toBe(1/Math.tan(Math.PI*(0.5-2**-52)));
  expect(calc('CONFIDENCE.T(1e-300,1e-100,2)')/(2/(Math.PI*1e-300)*(1e-100/Math.sqrt(2)))).toBeCloseTo(1,14);
  expect(calc('CONFIDENCE.T(1e-300,1e100,2)')).toEqual({error:'#NUM!'});
});
