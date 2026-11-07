import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// A complex number's parts are written to 15 significant digits, as Excel writes them. A
// part that needs exponent form was handed to the General format, which keeps about 10
// digits: 1.23456789012345E-07 came out as 1.234568E-07. Exponent form is written from the
// same 15 digits, with the exponent as E and a sign and at least two digits.
describe('complex number parts in exponent form', () => {
  it('keep 15 significant digits', () => {
    expect(calc('COMPLEX(1.23456789012345E-7,0)')).toBe('1.23456789012345E-07');
    // 2^1000 = 1.0715086071862673E+301: fifteen digits of it.
    expect(calc('IMPOWER("2",1000)')).toBe('1.07150860718627E+301');
    // 2^100 = 1267650600228229401496703205376 = 1.26765060022823E+30 at fifteen digits.
    expect(calc('IMPOWER("2",100)')).toBe('1.26765060022823E+30');
    expect(calc('COMPLEX(0,-1.23456789012345E-7)')).toBe('-1.23456789012345E-07i');
    expect(calc('COMPLEX(1.5E-7,2.5E-7,"j")')).toBe('1.5E-07+2.5E-07j');
  });

  it('drop the zeros a short mantissa does not need and read their own output back', () => {
    expect(calc('COMPLEX(1E-7,0)')).toBe('1E-07');
    expect(calc('COMPLEX(1.5E+25,0)')).toBe('1.5E+25');
    expect(calc('COMPLEX(1E+21,1)')).toBe('1E+21+i');
    expect(calc('IMREAL(COMPLEX(1.23456789012345E-7,0))')).toBe(1.23456789012345e-7);
    expect(calc('IMAGINARY(COMPLEX(0,-1.23456789012345E-7))')).toBe(-1.23456789012345e-7);
  });

  it('leave parts in plain form as they were', () => {
    expect(calc('COMPLEX(1.5,2.5)')).toBe('1.5+2.5i');
    expect(calc('COMPLEX(3,-1)')).toBe('3-i');
    expect(calc('COMPLEX(0.1,0)')).toBe('0.1');
    expect(calc('COMPLEX(1E+20,0)')).toBe('100000000000000000000');
  });
});
