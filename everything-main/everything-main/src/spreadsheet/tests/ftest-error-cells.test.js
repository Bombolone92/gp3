import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// F.TEST carries an error found in either array, as T.TEST, CORREL and the other paired statistics
// do, instead of dropping the cell and testing the variance of what is left.
describe('F.TEST over an array holding an error', () => {
  const D = { A1: '1', A2: '2', A3: '3', B1: '2', B2: '4', B3: '=1/0' };

  it('answers the error from either array', () => {
    expect(calc('F.TEST(A1:A3,B1:B3)', D)).toEqual(E('#DIV/0!'));
    expect(calc('F.TEST(B1:B3,A1:A3)', D)).toEqual(E('#DIV/0!'));
    expect(calc('FTEST(A1:A3,B1:B3)', D)).toEqual(E('#DIV/0!'));
    expect(calc('F.TEST(A1:A3,B1:B3)', { ...D, B3: '=NA()' })).toEqual(E('#N/A'));
    expect(calc('T.TEST(A1:A3,B1:B3,2,2)', D)).toEqual(E('#DIV/0!'));
  });

  it('still passes over text and blank cells and needs two numbers on each side', () => {
    expect(calc('F.TEST(A1:A3,B1:B3)', { ...D, B3: 'x' })).toBeCloseTo(0.585786, 6); // var 1 against var 2 on 2 and 1 degrees of freedom
    expect(calc('F.TEST(A1:A3,B1:B3)', { ...D, B3: '' })).toBeCloseTo(0.585786, 6);
    expect(calc('F.TEST(A1:A3,B1:B2)', D)).toBeCloseTo(0.585786, 6);
    expect(calc('F.TEST(A1:A3,B1)', D)).toEqual(E('#DIV/0!'));
    expect(calc('F.TEST({1,2,3,4,5},{2,4,6,9,12})')).toBeCloseTo(0.101779, 5); // variances 2.5 and 15.8: F = 6.32 on 4 and 4 degrees of freedom, two-tailed
  });
});
