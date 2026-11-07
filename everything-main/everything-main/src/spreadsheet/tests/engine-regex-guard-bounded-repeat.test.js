import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat } from '../src/core/formula/regex-safety.js';

// The guard judged only groups repeated without bound, so a bounded repeat of an ambiguous group,
// (.*a){14}, compiled and then hung the tab on a 29-character cell: from three iterations up the
// engine tries every way of dividing the text between them, as it does for an unbounded repeat.
describe('the nested-repeat guard on bounded repeats', () => {
  it.each(['(.*a){14}', '^(.*a){3}$', '(a|ab){10}', '(\\w+\\s?){5}x', '^(a+){6}b$', '((a+)+){2}', '(x+x){3}', '^(a{0,2}){20}b$', '^(a?b?){20}c$', '^(\\w{0,3}){15}!$',
    // A body of one optional character was taken to be settled a character at a time and exempted; it
    // is not, and (a?){20}b costs 1.7 s on a thirty-character cell. The ways such a group can match
    // are counted like any other's.
    '(a?){28}a{28}', '^(\\w?){40}\\w{40}$', '(a?){20}b', '(\\w?){20}Z'])
    ('refuses the bounded repeat of an ambiguous group %s', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(true);
    });

  it.each(['^(\\d{1,3}\\.){3}\\d{1,3}$', '(\\d+\\.){2}\\d+', '([a-z]+ ?){2}', '(\\w+\\s?){2}x', '^(\\w+ ){2}\\w+$', '^(ab?){20}c$', '(\\.\\w+){3}'])
    ('allows the bounded repeat %s, settled by its first character or within two iterations', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(false);
      expect(() => new RegExp(pattern, 'u')).not.toThrow();
    });

  it('answers #VALUE! from REGEXMATCH without trying the pattern', () => {
    const t0 = performance.now();
    expect(calc('REGEXMATCH(REPT("a",28)&"!","^(.*a){14}$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH(REPT("a",40),"^(\\w+\\s?){6}x$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH("1.2.3","^(\\d{1,3}\\.){2}\\d{1,3}$")')).toBe(true);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
