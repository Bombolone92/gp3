import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

describe('FIXED and DOLLAR rounding', () => {
  it('print a number too large to scale by its decimals in full instead of as an infinity sign', () => {
    // 1E+308 times 100 overflows a double; a number that large is already whole, so its decimals are zeros.
    expect(calc('FIXED(1E+307*10,2)')).toMatch(/^1\d\d(,\d{3}){102}\.00$/); // 309 digits
    expect(calc('DOLLAR(1E+307*10)')).toMatch(/^\$1\d\d(,\d{3}){102}\.00$/);
    expect(calc('FIXED(1E+300,10,TRUE)')).toMatch(/^1\d{300}\.0{10}$/);
    expect(calc('FIXED(-1E+307*10,2)')).toMatch(/^-1\d\d(,\d{3}){102}\.00$/);
    expect(calc('FIXED(1E+22,2)')).toBe('10,000,000,000,000,000,000,000.00');
  });

  it('round half away from zero on the value\'s 15 significant digits, as ROUND does', () => {
    // 2.4999999995 is below a half at every one of its 15 significant digits, so it rounds down;
    // an absolute nudge of 1e-9 before rounding tipped it up.
    expect(calc('FIXED(2.4999999995,0)')).toBe('2');
    expect(calc('DOLLAR(2.4999999995,0)')).toBe('$2');
    expect(calc('FIXED(-2.4999999995,0)')).toBe('-2');
    expect(calc('FIXED(2.5,0)')).toBe('3');
    expect(calc('FIXED(-2.5,0)')).toBe('-3');
    // 1.005 and 8.325 are halves to a spreadsheet though not in binary; they round up as ROUND rounds them.
    expect(calc('FIXED(1.005,2)')).toBe('1.01');
    expect(calc('FIXED(8.325,2)')).toBe(calc('TEXT(8.325,"0.00")'));
    expect(calc('FIXED(1234.567,1)')).toBe('1,234.6');
    expect(calc('DOLLAR(1234.567,-2)')).toBe('$1,200');
    expect(calc('DOLLAR(1250,-2)')).toBe('$1,300');
    expect(calc('DOLLAR(-1234.567,0)')).toBe('($1,235)');
  });
});
