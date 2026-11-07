import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// Two points lie symmetrically about their own mean, so their population skew is 0 whatever they
// are. Answering 0 read as "perfectly symmetric" where there is no skew to measure; SKEW.P is
// #DIV/0! below three data points, as SKEW is below three and KURT below four.
describe('SKEW.P with fewer than three numbers', () => {
  it('is #DIV/0!, as SKEW and KURT are at their own bounds', () => {
    expect(calc('SKEW.P(1,2)')).toEqual(E('#DIV/0!'));
    expect(calc('SKEW.P({1;2})')).toEqual(E('#DIV/0!'));
    expect(calc('SKEW.P(1)')).toEqual(E('#DIV/0!'));
    expect(calc('SKEW.P(5,5)')).toEqual(E('#DIV/0!'));
    expect(calc('SKEW.P(A1:A2)', { A1: '4', A2: '9' })).toEqual(E('#DIV/0!'));
    expect(calc('SKEW(1,2)')).toEqual(E('#DIV/0!'));
    expect(calc('KURT(1,2,3)')).toEqual(E('#DIV/0!'));
  });

  it('still answers from three numbers on, and still reports a flat sample', () => {
    // {1,2,4}: mean 7/3, population sd sqrt(14)/3, so the skew is the documented positive value.
    expect(calc('SKEW.P(1,2,4)')).toBeCloseTo(0.3818017741606059, 12);
    expect(calc('SKEW.P(1,2,3)')).toBeCloseTo(0, 12);
    expect(calc('SKEW.P({3,4,5,2,3,4,5,6,4,7})')).toBeCloseTo(0.303193, 5);
    expect(calc('SKEW.P(1,1,1)')).toEqual(E('#DIV/0!'));
    // Text and blanks in a reference are skipped, so a column of three with text in it is short.
    expect(calc('SKEW.P(A1:A3)', { A1: '1', A2: 'x', A3: '4' })).toEqual(E('#DIV/0!'));
  });
});
