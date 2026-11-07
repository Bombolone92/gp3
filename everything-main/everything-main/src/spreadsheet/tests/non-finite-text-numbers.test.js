import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { compareValues, toNumber } from '../src/core/formula/functions.js';

// Text such as "1e400" cannot be converted and becomes #VALUE!
// wherever it is coerced, never an Infinity that ISNUMBER takes for a number or that a
// comparison finds equal to everything.
const E = (code) => ({ error: code });

describe('non-finite numbers from text', () => {
  it('are #VALUE! when coerced, in negation and in percent', () => {
    expect(toNumber('1e400')).toEqual(E('#VALUE!'));
    expect(toNumber('-1e400')).toEqual(E('#VALUE!'));
    expect(toNumber('1e400%')).toEqual(E('#VALUE!'));
    expect(calc('ISNUMBER(-"1e400")')).toBe(false);
    expect(calc('-"1e400"')).toEqual(E('#VALUE!'));
    expect(calc('"1e400"%')).toEqual(E('#VALUE!'));
    expect(calc('-A1&""', { A1: '1e400' })).toEqual(E('#VALUE!')); // an error object, not formatted text
    expect(calc('ISERROR(-A1)', { A1: '1e400' })).toBe(true);
    expect(calc('VALUE("1e400")')).toEqual(E('#VALUE!'));
    expect(calc('SUM(A1:A2)', { A1: '1e400', A2: '1' })).toBe(1); // text in a range is skipped
  });

  it('do not compare equal to everything', () => {
    expect(compareValues(Infinity, 5)).toBe(1);
    expect(compareValues(-Infinity, 5)).toBe(-1);
    expect(compareValues(Infinity, Infinity)).toBe(0);
    expect(compareValues(5, -Infinity)).toBe(1);
    expect(calc('IF(-A1<0,"neg","pos")', { A1: '1e400' })).toEqual(E('#VALUE!'));
    expect(calc('IFERROR(IF(-A1<0,"neg","pos"),"overflow")', { A1: '1e400' })).toBe('overflow');
  });

  it('leave ordinary numbers and negations alone', () => {
    expect(calc('-"5"')).toBe(-5);
    expect(calc('-A1', { A1: '2.5' })).toBe(-2.5);
    expect(calc('"50"%')).toBe(0.5);
    expect(calc('SUM(-{1,2,3})')).toBe(-6);
    expect(calc('-"1e308"*10')).toEqual(E('#VALUE!'));
    expect(calc('(1E307*10)*10')).toEqual(E('#NUM!'));
  });
});
