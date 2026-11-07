import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat, subjectLimit } from '../src/core/formula/regex-safety.js';
import { compilePattern } from '../src/core/search.js';

// The guard exempted a group whose body is one optional character, on the belief that (a?){28} is
// settled a character at a time. It is not: (?:a?){20}Z takes 1.9 s on a thirty-character cell, and
// wrapping such a group in a {2} repeat — which the guard did not count as a repeat either — hid it
// from every check, so (?:(?:a?){16}){2}Z compiled and then ran for a hundred seconds on a
// ten-character cell. A formula holding one freezes the tab for as long as it takes, survives a
// reload and so makes the file unopenable. The ways a bounded group can match are now counted
// whatever its repeat count, and nothing is exempted by the shape of its body.

const ATTACKS = [
  '(?:(?:a?){16}){2}Z',
  '(?:(?:a?){20}){2}Z',
  '(?:(?:.?){20}){2}Z',
  '(?:(?:a?){10}){2}(?:(?:a?){10}){2}Z',
  '(?:(?:a?){10}){3}Z',
  '(?:(?:(?:(?:(?:a?){2}){2}){2}){2}){2}Z',
  '(?:a?){16}Z',
  '(?:a?){20}Z',
  '(a?){20}b',
  '(\\w?){20}Z',
  '(a?){28}a{28}',
  '^(\\w?){40}\\w{40}$',
];

// The everyday patterns the guard must keep accepting, whatever it refuses.
const EVERYDAY = [
  '^(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)$',
  '^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$',
  '^(\\d{1,3}\\.){3}\\d{1,3}$', '^\\d{3}-\\d{2}-\\d{4}$', '^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$',
  '^\\+?\\d{1,3}[- ]?\\(?\\d{3}\\)?[- ]?\\d{3}[- ]?\\d{4}$', '^\\d{4}-\\d{2}-\\d{2}$',
  '^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', '^[A-Z]{2}\\d{2}[A-Z0-9]{1,30}$',
  '\\$?\\d{1,3}(,\\d{3})*(\\.\\d+)?', '^(\\w+\\s)*\\w+$', '(?:\\S+\\s+){2}\\S+', '(\\.\\w+)+',
  '^(\\d+\\.){2}\\d+$', '\\b(\\w+)\\s+\\1\\b', '\\p{L}+', '[\\u0400-\\u04FF]+',
  '(\\d+\\.){2}\\d+', '([a-z]+ ?){2}', '(\\w+\\s?){2}x', '^(\\w+ ){2}\\w+$', '^(ab?){20}c$',
  '(\\.\\w+){3}', '(a|ab){8}', '(a|a){3}', '(?:1?\\d?\\d\\.){3}', '^(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$',
];

describe('the nested-repeat guard on a repeat composed around another repeat', () => {
  it.each(ATTACKS)('refuses %s', (pattern) => {
    expect(nestedRepeat(pattern)).toBe(true);
  });

  it.each(EVERYDAY)('still allows %s', (pattern) => {
    expect(nestedRepeat(pattern)).toBe(false);
    expect(() => new RegExp(pattern, 'u')).not.toThrow();
  });

  it('answers #VALUE! from the REGEX functions without trying the pattern', () => {
    const t0 = performance.now();
    for (const pattern of ATTACKS) {
      expect(calc(`REGEXMATCH(A1,"${pattern}")`, { A1: 'a'.repeat(10) })).toEqual({ error: '#VALUE!' });
    }
    expect(calc('REGEXREPLACE(A1,"(?:(?:a?){16}){2}Z","x")', { A1: 'a'.repeat(10) })).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXEXTRACT(A1,"(?:a?){20}Z")', { A1: 'a'.repeat(10) })).toEqual({ error: '#VALUE!' });
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('refuses the same patterns in QUERY and in the find bar', () => {
    const t0 = performance.now();
    expect(calc('QUERY(A1:A2,"select A where A matches \'(?:(?:a?){16}){2}Z\'")', { A1: 'aaaaaaaaaa', A2: 'x' })).toHaveProperty('error');
    expect(compilePattern('(?:(?:a?){16}){2}Z')).toBeNull();
    expect(compilePattern('(?:a?){20}Z')).toBeNull();
    expect(compilePattern('^\\d{4}-\\d{2}-\\d{2}$')).not.toBeNull();
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('leaves the length limit of the patterns it allows where it was', () => {
    expect(subjectLimit('(https?:\\/\\/)?([\\w-]+\\.)+[\\w-]+')).toBe(1000);
    expect(subjectLimit('(?:[A-Z][a-z]+ ){1,3}[A-Z][a-z]+')).toBe(1000);
    expect(subjectLimit('^\\d{4}-\\d{2}-\\d{2}$')).toBe(Infinity);
  });
});
