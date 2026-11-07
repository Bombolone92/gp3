import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// INT, QUOTIENT, ISEVEN and ISODD take their number at 15 significant digits, as TRUNC, ROUNDDOWN,
// FLOOR, EVEN and ODD already do: 0.3/0.1 is 2.9999999999999996 in binary and 3 to a spreadsheet,
// so INT(0.3/0.1) is 3 like TRUNC(0.3/0.1), QUOTIENT(0.3,0.1) is the integer part of that
// division, and ISODD(0.3/0.1) is TRUE, instead of 2, 2 and FALSE beside TRUNC's 3.
describe('INT, QUOTIENT, ISEVEN and ISODD at fifteen significant digits', () => {
  it('INT agrees with TRUNC on positive decimal arithmetic', () => {
    expect(calc('INT(0.3/0.1)')).toBe(3);
    expect(calc('INT((0.1+0.7)*10)')).toBe(8);
    expect(calc('INT(0.3/0.1)=TRUNC(0.3/0.1)')).toBe(true);
    expect(calc('INT((0.1+0.7)*10)=TRUNC((0.1+0.7)*10)')).toBe(true);
    expect(calc('INT(2.999999999999999)')).toBe(2); // literal truncates to 2.99999999999999 first
    expect(calc('INT(2.9999999999999)')).toBe(2); // 14 significant digits: still below 3
    expect(calc('INT(-0.3/0.1)')).toBe(-3);
    expect(calc('INT(-1.5)')).toBe(-2);
    expect(calc('INT(5)')).toBe(5);
    expect(calc('INT(1E15+0.5)')).toBe(1e15);
  });

  it('QUOTIENT is the integer part of the division', () => {
    expect(calc('QUOTIENT(0.3,0.1)')).toBe(3);
    expect(calc('QUOTIENT(-0.3,0.1)')).toBe(-3);
    expect(calc('QUOTIENT(0.3,0.1)=TRUNC(0.3/0.1)')).toBe(true);
    expect(calc('QUOTIENT(-7,2)')).toBe(-3);
    expect(calc('QUOTIENT(5,2)')).toBe(2);
    expect(calc('QUOTIENT(1,3)')).toBe(0);
    expect(calc('QUOTIENT(1,0)')).toEqual({ error: '#DIV/0!' });
  });

  it('ISEVEN and ISODD judge the whole part at fifteen digits', () => {
    expect(calc('ISEVEN(0.3/0.1*2)')).toBe(true);
    expect(calc('ISODD(0.3/0.1)')).toBe(true);
    expect(calc('ISEVEN(0.3/0.1)')).toBe(false);
    expect(calc('ISEVEN(2.5)')).toBe(true);
    expect(calc('ISODD(-3.7)')).toBe(true);
    expect(calc('ISEVEN(0)')).toBe(true);
    expect(calc('ISODD(4)')).toBe(false);
  });
});
