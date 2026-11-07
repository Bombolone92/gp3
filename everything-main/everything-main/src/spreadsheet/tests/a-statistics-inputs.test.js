import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-a-statistics-inputs.json',import.meta.url),'utf8'));
it.each(native.cases)('matches native A-function $kind input: $expression', ({formula,cells,expected}) => {
  expect(calc(formula,cells)).toBe(expected);
});

it('distinguishes value arrays from cell references without changing direct coercion', () => {
  const cells={A1:'0',A2:'FALSE',A3:'3'};
  expect(calc('VARA(A1:A3)',cells)).toBe(3);
  expect(calc('VARA(A1,A2,A3)',cells)).toBe(3);
  expect(calc('VARA(HSTACK(A1:A3))',cells)).toBe(4.5);
  expect(calc('VARA({0,FALSE,3})')).toBe(4.5);
  expect(calc('VARA(0,FALSE,3)')).toBe(3);
  expect(calc('AVERAGEA({2,TRUE,3})')).toBe(2.5);
  expect(calc('AVERAGEA({2,"text",3})')).toBe(5/3);
  expect(calc('MINA({2,"text",3})')).toBe(2);
  expect(calc('MAXA({-2,FALSE,-3})')).toBe(-2);
});
