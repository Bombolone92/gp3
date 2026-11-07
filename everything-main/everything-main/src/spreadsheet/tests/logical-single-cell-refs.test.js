import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('ignores text in a single-cell reference the way it does inside a range', () => {
  const cells = { A1: 'abc', A2: 'TRUE', A3: '0', A4: '=1/0' };
  expect(calc('AND(TRUE,A1)', cells)).toBe(true);
  expect(calc('OR(FALSE,A1)', cells)).toBe(false);
  expect(calc('XOR(TRUE,A1)', cells)).toBe(true);
  expect(calc('AND(A1:A2)', cells)).toBe(true);
  expect(calc('AND(TRUE,A3)', cells)).toBe(false);
  expect(calc('OR(A3,A2)', cells)).toBe(true);
  expect(calc('AND(TRUE,B1)', cells)).toBe(true); // a blank cell is ignored
  expect(calc('AND(A1)', cells)).toEqual({ error: '#VALUE!' }); // nothing logical at all
  expect(calc('AND(TRUE,A4)', cells)).toEqual({ error: '#DIV/0!' });
});

it('still converts direct arguments', () => {
  expect(calc('AND(TRUE,"TRUE")')).toBe(true);
  expect(calc('AND(TRUE,"abc")')).toEqual({ error: '#VALUE!' });
  expect(calc('OR(0,1)')).toBe(true);
  expect(calc('AND(A1>0,A1<5)', { A1: '3' })).toBe(true);
  expect(calc('XOR(TRUE,TRUE,TRUE)')).toBe(true);
});
