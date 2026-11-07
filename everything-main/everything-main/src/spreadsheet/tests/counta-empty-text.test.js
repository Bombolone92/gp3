import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('counts cells holding empty text as non-empty', () => {
  const cells = { A1: '=""', A2: '=IF(TRUE,"","x")', A3: 'x' };
  expect(calc('COUNTA(A1:A3)', cells)).toBe(3);
  expect(calc('COUNTA(A1:A10)', cells)).toBe(3);
  expect(calc('COUNTA("")')).toBe(1);
  expect(calc('COUNTA("",1,TRUE)')).toBe(3);
  expect(calc('COUNTBLANK(A1:A3)', cells)).toBe(2);
  expect(calc('COUNTA(A1:A3)+COUNTBLANK(A1:A3)', cells)).toBe(5);
  expect(calc('COUNTA(B1:B5)', cells)).toBe(0);
});
