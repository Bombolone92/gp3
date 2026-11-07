import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// COMPLEX(1.5E-20,1) was "i", COMPLEX(1,-1E-16) was "1" and IMREAL(IMSUM("1E-20+i")) was 0: the
// formatter swept a part below 1e-14 beside a larger one as the rounding noise of a calculation,
// but COMPLEX, IMSUM and IMSUB compute nothing that rounds a part against the other, and a typed
// 1E-16 is a value that no size rule can tell from noise. They now write their parts as given; the
// sweep stays for the results of IMEXP, IMPOWER and the other computed functions.
describe('tiny parts of a complex number', () => {
  it('keeps every part COMPLEX, IMSUM and IMSUB are given', () => {
    expect(calc('COMPLEX(1.5E-20,1)')).toBe('1.5E-20+i');
    expect(calc('COMPLEX(1,-1E-16)')).toBe('1-1E-16i');
    expect(calc('COMPLEX(1E10,0.00001)')).toBe('10000000000+0.00001i');
    expect(calc('IMSUM("1E-20+i")')).toBe('1E-20+i');
    expect(calc('IMREAL(IMSUM("1E-20+i"))')).toBe(1e-20);
    expect(calc('IMSUM("1E10","0.000001i")')).toBe('10000000000+0.000001i');
    expect(calc('IMSUB("1E-20+i","i")')).toBe('1E-20');
    expect(calc('IMSUB("1+i","1")')).toBe('i');
    // The rounding of 0.1+0.2-0.3 is written as it is.
    expect(calc('IMSUM("0.1+i","0.2","-0.3")')).toBe('5.55111512312578E-17+i');
  });

  it('still sweeps the rounding noise of a computed result beside a real part', () => {
    expect(calc('IMEXP(COMPLEX(0,PI()))')).toBe('-1');
    expect(calc('IMPOWER("i",2)')).toBe('-1');
    expect(calc('IMPOWER("1+i",4)')).toBe('-4');
    expect(calc('IMSQRT(-4)')).toBe('2i');
    expect(calc('IMPRODUCT("1+i","1-i")')).toBe('2');
    expect(calc('IMDIV("1+i","1+i")')).toBe('1');
  });

  it('keeps a tiny computed part that stands on its own scale', () => {
    expect(calc('IMSQRT(-1E-30)')).toBe('1E-15i');
    expect(calc('IMPRODUCT("1E10","1E-6i")')).toBe('10000i');
    expect(calc('IMPRODUCT("1E10+1E-6i","1")')).toBe('10000000000+0.000001i');
  });
});
