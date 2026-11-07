import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat } from '../src/core/formula/regex-safety.js';

const fruit = { A1: 'apple', A2: 'berry', A3: 'avocado' };

describe('QUERY text patterns', () => {
  // `matches` and `like` compiled a new RegExp for every row; the compiled patterns are now kept.
  it('still filter with matches and like', () => {
    expect(calc('QUERY(A1:A3,"select A where A matches \'a.*\'")', fruit)).toBe('apple');
    expect(calc('QUERY(A1:A3,"select A where A like \'%rr%\'")', fruit)).toBe('berry');
    expect(calc('QUERY(A1:A3,"select A where A like \'a_p%\'")', fruit)).toBe('apple');
    expect(calc('QUERY(A1:A3,"select A where A like \'b_o%\' or A matches \'.*cado\'")', fruit)).toBe('avocado');
  });

  // The same pattern that hangs REGEXMATCH would hang QUERY, so the guard is shared.
  it('refuse a pattern whose nested repeats could run for ever', () => {
    expect(calc('QUERY(A1:A3,"select A where A matches \'(a+)+\'")', fruit)).toHaveProperty('error');
    expect(calc('REGEXMATCH("apple","(a+)+")')).toEqual({ error: '#VALUE!' });
    expect(nestedRepeat('(a+)+')).toBe(true);
    expect(nestedRepeat('(\\d+\\.)+\\d+')).toBe(false);
  });
});
