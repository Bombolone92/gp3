import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-deviation-underflow.json',import.meta.url),'utf8'));
it.each(native.cases)('matches native deviation arithmetic: $expression', ({formula,cells,expected}) => {
  expect(calc(formula,cells)).toBe(expected);
});

it('flushes each squared deviation and the final variance before taking its square root', () => {
  expect(calc('DEVSQ({1e-154,-1e-154,1e-154,-1e-154})')).toBe(0);
  expect(calc('DEVSQ({0,0,3e-154})') * 1e307).toBeCloseTo(0.4,14);
  for (const fn of ['VAR.P','VAR.S','STDEV.P','STDEV.S','VAR','VARP','STDEV','STDEVP','VARA','VARPA','STDEVA','STDEVPA']) {
    expect(calc(`${fn}({0,0,3e-154})`)).toBe(0);
  }
  expect(calc('VAR.P({0,3e-154})') * 1e307).toBeCloseTo(0.225,14);
  expect(calc('STDEV.P({0,3e-154})') / 1e-154).toBeCloseTo(1.5,14);
});

it('retains sample-size rules and reports errors when derived statistics have zero spread', () => {
  expect(calc('DEVSQ(A1:A2)')).toEqual({error:'#NUM!'});
  expect(calc('DEVSQ(1)')).toBe(0);
  expect(calc('VAR.S(1)')).toEqual({error:'#DIV/0!'});
  expect(calc('VAR.P(1)')).toBe(0);
  for (const fn of ['SKEW','SKEW.P','KURT']) expect(calc(`${fn}({0,1e-154,2e-154,3e-154})`)).toEqual({error:'#DIV/0!'});
  expect(calc('F.TEST({0,1e-154},{0,1e-154})')).toEqual({error:'#DIV/0!'});
  expect(calc('VAR.P(0,1e-154,NA())')).toEqual({error:'#N/A'});
});
