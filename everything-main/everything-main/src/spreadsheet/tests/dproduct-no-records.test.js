import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// DPRODUCT of no matching record answered 1, the seed of an empty product. PRODUCT of nothing is 0
// here, and so now is DPRODUCT when no record matches or the matches hold no number.
const DB = { A1: 'h', A2: '2', A3: '3', C1: 'h', C2: '>5', E1: 'h', E2: '>1', G1: 'h', G2: '>2' };

it('answers 0 when no record matches', () => {
  expect(calc('DPRODUCT(A1:A3,"h",C1:C2)', DB)).toBe(0);
  expect(calc('DPRODUCT({"h";2;3},"h",{"h";">5"})')).toBe(0);
});

it('answers 0 when the matching records hold no number', () => {
  expect(calc('DPRODUCT({"h";"x";"y"},"h",{"h";"x"})')).toBe(0);
});

it('multiplies the matching records as before', () => {
  expect(calc('DPRODUCT(A1:A3,"h",E1:E2)', DB)).toBe(6);
  expect(calc('DPRODUCT(A1:A3,1,G1:G2)', DB)).toBe(3);
  expect(calc('PRODUCT(B1:B3)', DB)).toBe(0);
});
