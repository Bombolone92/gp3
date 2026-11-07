import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// RANDARRAY with whole_number TRUE returns whole numbers between min and max, so only the
// integers inside the bounds can come out (as RANDBETWEEN draws them); when there is none,
// no value satisfies the arguments and the answer is the #VALUE! that min above max gives.
const VALUE = { error: '#VALUE!' };

describe('RANDARRAY whole numbers with fractional bounds', () => {
  it('never returns a value outside the bounds', () => {
    expect(calc('RANDARRAY(1,1,0.2,0.8,TRUE)')).toEqual(VALUE);
    expect(calc('RANDARRAY(1,1,1.5,1.5,TRUE)')).toEqual(VALUE);
    expect(calc('RANDARRAY(2,2,2.1,2.9,TRUE)')).toEqual(VALUE);
    expect(calc('RANDARRAY(1,1,2,2,TRUE)')).toBe(2);
    expect(calc('RANDARRAY(1,1,1.5,2.5,TRUE)')).toBe(2);
    for (let i = 0; i < 20; i++) {
      expect(calc('LET(x,RANDARRAY(3,3,0.5,2.5,TRUE),AND(MIN(x)>=1,MAX(x)<=2,SUMPRODUCT(--(x=INT(x)))=9))')).toBe(true);
    }
  });

  it('keeps fractional bounds for decimal values', () => {
    expect(calc('LET(x,RANDARRAY(3,3,0.2,0.8),AND(MIN(x)>=0.2,MAX(x)<0.8))')).toBe(true);
    expect(calc('RANDARRAY(1,1,3,2)')).toEqual(VALUE);
  });
});
