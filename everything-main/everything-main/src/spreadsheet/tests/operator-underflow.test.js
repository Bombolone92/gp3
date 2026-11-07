import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc, calcValues } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-operator-underflow.json', import.meta.url), 'utf8'));

it.each(native.cases)('matches native arithmetic underflow: $expression', ({formula, expected}) => {
  expect(calc(formula)).toBe(expected);
});

it('flushes at each multiplication, division and percent operation before later arithmetic', () => {
  for (const expression of ['1e-307/10', '-1e-307/10', '1e-307*0.1', '-1e-307*0.1', '1e-307%', '(-1e-307)%']) {
    expect(calc(expression)).toBe(0);
    expect(calc(`(${expression})*1e307`)).toBe(0);
    expect(calc(`1/(${expression})`)).toEqual({error:'#DIV/0!'});
  }
});

it('retains normal results at the binary64 boundary without rounding ordinary arithmetic', () => {
  const min = 2 ** -1022;
  expect(calc('(2^-1022)*1')).toBe(min);
  expect(calc('(2^-1022)/1')).toBe(min);
  expect(calc('2^-1022*(1-2^-52)')).toBe(0);
  expect(calc('2^-1022*(1+2^-52)')).toBe(min * (1 + 2 ** -52));
  expect(calc('2^-1022/2')).toBe(0);
  expect(calc('0.1*0.2')).toBe(0.1 * 0.2);
  expect(calc('1/3')).toBe(1 / 3);
  expect(calc('1e307*100')).toEqual({error:'#NUM!'});
});

it('does not flush subnormal operands or every function and operator result', () => {
  const tiny = Math.exp(-710);
  expect(calc('EXP(-710)')).toBe(tiny);
  expect(calc('EXP(-710)+EXP(-710)')).toBe(tiny + tiny);
  expect(calc('EXP(-710)-(-EXP(-710))')).toBe(tiny + tiny);
  expect(calc('1e-154^2')).toBe(1e-154 ** 2);
  expect(calc('EXP(-710)*1e307')).toBe(tiny * 1e307);
  expect(calc('EXP(-710)/0.1')).toBe(tiny / 0.1);
  expect(calcValues('A1*1e307', {A1:tiny})).toBe(tiny * 1e307);
  expect(calcValues('A1/0.1', {A1:tiny})).toBe(tiny / 0.1);
  expect(calcValues('A1/A1', {A1:tiny})).toEqual({error:'#DIV/0!'});
});

it('broadcasts underflow and errors independently to each array element', () => {
  expect(calc('SUM({1e-307,1}/10)')).toBe(0.1);
  expect(calc('SUM({1e-307,1}*0.1)')).toBe(0.1);
  expect(calc('SUM({1e-307,1}%)')).toBe(0.01);
  expect(calc('INDEX(1/({1e-307,10}/10),1,1)')).toEqual({error:'#DIV/0!'});
  expect(calc('INDEX(1/({1e-307,10}/10),1,2)')).toBe(1);
});
