import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const NUM = { error: '#NUM!' };

// GCD answers #NUM! for an argument of 2^53 or more, and LCM for an argument or a result of 2^53
// or more, as documented, instead of a double rounded to the nearest representable integer
// posing as the exact answer: LCM(3037000500,3037000499) gave 9223372033963250000 where the
// product is 9223372033963249500.
describe('GCD and LCM at 2^53', () => {
  it('refuse a GCD argument of 2^53 or more', () => {
    expect(calc('GCD(2^53,2)')).toEqual(NUM);
    expect(calc('GCD(2^60,2^61)')).toEqual(NUM);
    expect(calc('GCD(1,2^53)')).toEqual(NUM);
    expect(calc('GCD(2^53-1,1)')).toBe(1);
    expect(calc('GCD(2^52,2^51)')).toBe(2251799813685248);
  });

  it('refuse an LCM of 2^53 or more, whether from an argument or the product', () => {
    expect(calc('LCM(3037000500,3037000499)')).toEqual(NUM);
    expect(calc('LCM(2^40,2^40+1)')).toEqual(NUM);
    expect(calc('LCM(99999,99998,99997,99996)')).toEqual(NUM);
    expect(calc('LCM(2^53,1)')).toEqual(NUM);
    expect(calc('LCM(2^52,3)')).toEqual(NUM);
    expect(calc('LCM(2^30,2^30+1,2)')).toEqual(NUM); // the running result passes 2^53 before the last argument
  });

  it('answer exactly below the limit', () => {
    expect(calc('LCM(2^52,2)')).toBe(4503599627370496);
    expect(calc('LCM(2^26,2^26-1)')).toBe(4503599560261632); // 67108864 * 67108863, exact
    expect(calc('LCM(2,3,5,7,11,13,17,19,23)')).toBe(223092870);
    expect(calc('GCD(12,18,30)')).toBe(6);
    expect(calc('LCM(4,6)')).toBe(12);
    expect(calc('LCM(0,5)')).toBe(0);
    expect(calc('GCD(0,0)')).toBe(0);
    expect(calc('GCD(-1,2)')).toEqual(NUM);
  });
});
