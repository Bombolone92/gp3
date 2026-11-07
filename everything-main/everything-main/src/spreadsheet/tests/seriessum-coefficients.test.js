import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// SERIESSUM(x, n, m, coefficients) is a1·x^n + a2·x^(n+m) + …: every coefficient must be a
// number. Text, a boolean or an empty cell among them is #VALUE!, not a term
// silently left out of the sum.
describe('SERIESSUM coefficients', () => {
  it('rejects a coefficient that is not a number', () => {
    expect(calc('SERIESSUM(2,1,1,{1,"a"})')).toEqual(E('#VALUE!'));
    expect(calc('SERIESSUM(2,1,1,{1,TRUE})')).toEqual(E('#VALUE!'));
    expect(calc('SERIESSUM(2,1,1,A1:A2)', { A1: '1', A2: 'a' })).toEqual(E('#VALUE!'));
    expect(calc('SERIESSUM(2,1,1,A1:A3)', { A1: '1', A2: '2' })).toEqual(E('#VALUE!')); // A3 is empty
    expect(calc('SERIESSUM(2,1,1,A1:A2)', { A1: '1', A2: '=NA()' })).toEqual(E('#N/A')); // an error is itself
  });

  it('sums the series over numeric coefficients', () => {
    // 1·2^1 + 2·2^2 + 3·2^3 = 2 + 8 + 24 = 34.
    expect(calc('SERIESSUM(2,1,1,{1,2,3})')).toBe(34);
    expect(calc('SERIESSUM(2,1,1,A1:A3)', { A1: '1', A2: '2', A3: '3' })).toBe(34);
    // A column of coefficients reads the same as a row: 1·3^0 + 2·3^2 = 1 + 18 = 19.
    expect(calc('SERIESSUM(3,0,2,{1;2})')).toBe(19);
    // One coefficient given directly, as text that reads as a number: 3·2^1 = 6.
    expect(calc('SERIESSUM(2,1,1,"3")')).toBe(6);
    expect(calc('SERIESSUM(2,1,1,3)')).toBe(6);
  });
});
