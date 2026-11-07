import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

// Rounding scales the value by 10^places first; near the top of the double
// range that overflows to infinity and came back as #NUM!. Every double
// beyond 2^53 is already a whole number, so rounding it to any number of
// decimal places leaves it as it is. (A places count past the double range,
// as in ROUND(1.5,400), still reports #NUM! as before.)
// Use computed large values: a literal 1e308 is rejected, and literal decimal
// digits after the fifteenth are truncated before rounding is evaluated.
describe('rounding near the top of the double range', () => {
  it.each([
    ['ROUND((1E+307*10),2)', 1e308],
    ['ROUNDDOWN((1E+307*10),2)', 1e308],
    ['ROUNDUP((1E+307*10),2)', 1e308],
    ['TRUNC((1E+307*10),2)', 1e308],
    ['ROUND(-(1E+307*10),2)', -1e308],
    ['ROUNDUP(-(1E+307*10),5)', -1e308],
    ['ROUND((1E+307*10),400)', 1e308],
    ['TRUNC(123456789012345678,3)', 123456789012345000],
    ['ROUND(1E+300,0)', 1e300],
  ])('%s → %s', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it('retains every bit of a referenced large numeric value', () => {
    const wb = new Workbook(), id = wb.activeSheetId, value = 123456789012345678;
    wb.setCells(id, [{r:0,c:0,cell:{v:value}}, {r:0,c:1,cell:{f:'TRUNC(A1,3)'}}]);
    expect(wb.getValue(id,0,1)).toBe(value);
  });

  it('keeps ordinary rounding', () => {
    expect(calc('ROUND(2.5,0)')).toBe(3);
    expect(calc('ROUNDUP(3.14159,2)')).toBe(3.15);
    expect(calc('ROUNDDOWN(-3.14159,2)')).toBe(-3.14);
    expect(calc('TRUNC(4.35*100)')).toBe(435);
    expect(calc('ROUND(1234.567,-2)')).toBe(1200);
  });
});
