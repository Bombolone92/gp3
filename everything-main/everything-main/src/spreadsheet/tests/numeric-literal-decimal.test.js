import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { tokenize, FormulaSyntaxError } from '../src/core/formula/tokenizer.js';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-numeric-literals.json', import.meta.url), 'utf8'));

it.each(native.entryControls)('preserves complete numeric entry and expression syntax: $stored', ({ formula, value }) => {
  // These controls read back both formula and value.
  expect(calc(formula)).toBe(value);
});

it.each(native.cases)('matches native stored numeric tokens: $formula', ({ formula, accepted, number }) => {
  if (!accepted) {
    expect(() => tokenize(formula)).toThrow(FormulaSyntaxError);
    return;
  }
  const numbers = tokenize(formula).filter(t => t.type === 'number');
  expect(numbers.at(-1).value).toBe(number);
  // The offset describes the entire source token, including discarded digits.
  const token = numbers.at(-1);
  expect(token.end).toBe(formula.endsWith('%') ? formula.length - 1 : formula.length);
});

it('evaluates truncated literals consistently in operators, arrays, calls and lambdas', () => {
  for (const f of ['1.234567890123459', 'SUM(1.234567890123459)', 'INDEX({1.234567890123459,2},1,1)',
    'LAMBDA(x,x)(1.234567890123459)', 'LET(x,1.234567890123459,x)']) expect(calc(f)).toBe(1.23456789012345);
  expect(calc('1234567890123459-1234567890123450')).toBe(0);
  expect(calc('1e-308')).toBe(0);
  expect(calc('2.22507385850721e-308')).toBe(2.22507385850721e-308);
  expect(calc('1e307*10')).toBe(1e308);
  expect(calc('(1e307*10)*10')).toEqual({error:'#NUM!'});
  expect(calc('IFERROR(1e308,99)')).toEqual({error:'#ERROR!'});
});

it('keeps source positions, reference syntax and quoted numeric text separate', () => {
  const source = 'SUM(A1,123456789012345678)+Sheet2!B2';
  const tokens = tokenize(source), number = tokens.find(t => t.type === 'number');
  expect(number).toMatchObject({value:123456789012345000,start:7,end:25});
  expect(tokens.filter(t => t.type === 'ref').map(t => source.slice(t.start,t.end))).toEqual(['A1','Sheet2!B2']);
  expect(tokenize('1:1048576')[0]).toMatchObject({type:'ref'});
  expect(tokenize('"123456789012345678"')[0]).toMatchObject({type:'string',value:'123456789012345678'});
});
