import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// SUMPRODUCT takes an entry that is not a number as zero, TRUE and FALSE along with text. That is
// the whole reason the double unary is written: =SUMPRODUCT(--(A1:A6>3)) counts, =SUMPRODUCT(A1:A6>3)
// is 0. Multiplying TRUE by 1 instead made the undecorated form count too, so a formula written here
// read differently once exported, and the app disagreed with its own SUM over the identical array.
const NUMBERS = { A1: '5', A2: '3', A3: '9', A4: '1', A5: '7', A6: '3' };
const FLAGS = { B1: 'TRUE', B2: 'FALSE', B3: 'TRUE' };

describe('booleans inside SUMPRODUCT', () => {
  it('count as zero, wherever they come from', () => {
    expect(calc('SUMPRODUCT(A1:A6>3)', NUMBERS)).toBe(0);
    expect(calc('SUMPRODUCT({TRUE,FALSE},{1,2})')).toBe(0);
    expect(calc('SUMPRODUCT(B1:B3,{1;2;3})', FLAGS)).toBe(0);
    expect(calc('SUMPRODUCT(B1:B3)', FLAGS)).toBe(0);
    expect(calc('SUMPRODUCT(A1:A6,A1:A6>3)', NUMBERS)).toBe(0);
  });

  it('agrees with SUM over the same array', () => {
    expect(calc('SUM(A1:A6>3)', NUMBERS)).toBe(0);
    expect(calc('SUMPRODUCT(A1:A6>3)', NUMBERS)).toBe(calc('SUM(A1:A6>3)', NUMBERS));
  });

  it('still counts once the comparison is turned into a number', () => {
    expect(calc('SUMPRODUCT(--(A1:A6>3))', NUMBERS)).toBe(3);
    expect(calc('SUMPRODUCT((A1:A6>3)*1)', NUMBERS)).toBe(3);
    expect(calc('SUMPRODUCT((A1:A6>3)+0)', NUMBERS)).toBe(3);
    expect(calc('SUMPRODUCT(--(A1:A6>3),A1:A6)', NUMBERS)).toBe(21);
    expect(calc('SUMPRODUCT(N(A1:A6>3))', NUMBERS)).toBe(3);
  });

  it('leaves numbers, text and errors as they were', () => {
    expect(calc('SUMPRODUCT({1,2,3},{4,5,6})')).toBe(32);
    expect(calc('SUMPRODUCT(1,2,3)')).toBe(6);
    expect(calc('SUMPRODUCT("a",2)')).toBe(0);
    expect(calc('SUMPRODUCT(A1:A6,{1;1;1;1;1;1})', NUMBERS)).toBe(28);
    expect(calc('SUMPRODUCT(A1:A3,{1;1})', NUMBERS)).toEqual({ error: '#VALUE!' });
    expect(calc('SUMPRODUCT(A1:A3,{1;1;1})', { ...NUMBERS, A2: '=1/0' })).toEqual({ error: '#DIV/0!' });
  });
});
