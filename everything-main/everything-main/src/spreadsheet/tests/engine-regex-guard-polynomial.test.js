import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat } from '../src/core/formula/regex-safety.js';

// Overlapping repeats were judged only inside a repeated group, so a*a*a*a*b compiled and took
// eight seconds on a 400-character cell: each repeat multiplies the ways the text divides. Two
// in a row stay within the square of the text's length; from three the cost climbs to its cube.
describe('the nested-repeat guard on runs of repeats', () => {
  it.each(['^a*a*a*a*b$', 'a*a*a*b', '(a*)(a*)(a*)b', '\\w*\\w*\\w*!', '.*.*.*x', '(\\d+)?\\s*(\\w+)?\\s*(\\d+)?!'])
    ('refuses three overlapping repeats in a row %s', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(true);
    });

  it.each(['a*a*b', '.*cado', '^.*a$', '\\d+\\.\\d+', 'a+b+', '^\\s*-?\\d*\\.?\\d*\\s*$', '^\\s*(\\w+\\s*,\\s*)*\\w+\\s*$',
    '^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$', '(\\d+)?\\s*(\\w+)?', '\\d*\\.?\\d*', '\\s*\\w+\\s*', '[a-z]*[a-z0-9]*x'])
    ('allows %s, with at most two overlapping repeats open at once', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(false);
      expect(() => new RegExp(pattern, 'u')).not.toThrow();
    });

  it('answers #VALUE! from REGEXMATCH and QUERY without trying the pattern', () => {
    const t0 = performance.now();
    expect(calc('REGEXMATCH(REPT("a",400),"^a*a*a*a*b$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXREPLACE(REPT("a",400),"a*a*a*b","x")')).toEqual({ error: '#VALUE!' });
    expect(calc('QUERY(A1:A2,"select A where A matches \'a*a*a*b\'")', { A1: 'a'.repeat(400), A2: 'x' })).toHaveProperty('error');
    expect(calc('REGEXMATCH("aab","^a*a*b$")')).toBe(true);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
