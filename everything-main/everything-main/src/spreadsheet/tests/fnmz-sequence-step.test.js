import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

describe('SEQUENCE with a fractional step', () => {
  it('lands on start + k*step rather than drifting through a running sum', () => {
    // 0.1 added 999 times gives 99.8999999999986, which is not 99.9 even to 15 digits.
    expect(calc('INDEX(SEQUENCE(1000,1,0,0.1),1000)')).toBeCloseTo(99.9, 12);
    expect(calc('INDEX(SEQUENCE(1000,1,0,0.1),1000)=99.9')).toBe(true);
    expect(calc('INDEX(SEQUENCE(1,1000,0,0.1),1,1000)=99.9')).toBe(true);
    expect(calc('INDEX(SEQUENCE(100,10,0,0.1),100,10)=99.9')).toBe(true);
    expect(calc('SUM(SEQUENCE(1000,1,0,0.1))=SUM(SEQUENCE(1000,1,999*0.1,-0.1))')).toBe(true);
  });

  it('still fills by rows from start with the step', () => {
    expect(calc('INDEX(SEQUENCE(3,3,1,0.5),2,1)')).toBe(2.5);
    expect(calc('INDEX(SEQUENCE(3,3,1,0.5),3,3)')).toBe(5);
    expect(calc('INDEX(SEQUENCE(4,1,10,-2.5),4)')).toBe(2.5);
    expect(calc('INDEX(SEQUENCE(3),3)')).toBe(3);
    expect(calc('INDEX(SEQUENCE(2,2),2,2)')).toBe(4);
  });
});
