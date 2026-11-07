import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// An error given to COUNT or COUNTA directly was answered back, though the same error in a
// referenced range is a value to count (COUNTA) or to pass over (COUNT).
describe('COUNT and COUNTA given an error directly', () => {
  it('count it as a value that is not a number', () => {
    expect(calc('COUNTA(1/0)')).toBe(1);
    expect(calc('COUNTA(NA())')).toBe(1);
    expect(calc('COUNTA(1/0,"x",2)')).toBe(3);
    expect(calc('COUNT(1/0)')).toBe(0);
    expect(calc('COUNT(1/0,"x",2)')).toBe(1);
  });

  it('count it the same way inside a range', () => {
    const cells = { A1: '=1/0', A2: '1' };
    expect(calc('COUNTA(A1:A2)', cells)).toBe(2);
    expect(calc('COUNT(A1:A2)', cells)).toBe(1);
    expect(calc('COUNTA(A1)', cells)).toBe(1);
    expect(calc('COUNT(A1)', cells)).toBe(0);
  });
});
