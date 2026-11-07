import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat } from '../src/core/formula/regex-safety.js';

// The guard refuses only patterns whose repeated group can divide the same text in more than
// one way. A repeat that is always followed by a character it cannot consume is linear and allowed.
describe('the nested-repeat guard', () => {
  it.each([
    '^\\w+(\\.\\w+)+$', '(\\.\\d+)+', '(,\\s*\\w+)+', '(\\s\\w+)+', '(ab+)+', '(-\\d+)*', '(\\.[a-z]{2,})+',
    '(\\/[^\\/]+)+', '(a\\d+)+', '(\\d+\\.)+\\d+', '^[A-Z][a-z]+(\\s[A-Z][a-z]+)*$', '^\\s*(\\w+\\s*,\\s*)*\\w+\\s*$',
    '([^,]+,)*[^,]+', '(\\d+,)*\\d+', '(ab|cd)+', '(\\d|[a-z])+', '^(\\d{1,3}\\.){3}\\d{1,3}$',
    '(\\w+\\s)+', '^([a-z]+_)*[a-z]+$', '^(https?:\\/\\/)?([\\w-]+\\.)+[\\w-]+$', '(\\s+\\w+)*', 'a+b+', '\\d+\\.\\d+',
    '(?<year>\\d{4})-(?<month>\\d{2})', '(?:ab)+', 'x(?=y+)', '(a|b)+c',
  ])('allows the linear pattern %s', (pattern) => {
    expect(nestedRepeat(pattern)).toBe(false);
    expect(() => new RegExp(pattern, 'u')).not.toThrow();
  });

  it.each([
    '(a+)+', '(\\w+\\s?)*', '(x|y+)+', '^(a|a)+$', '(a|ab)*', '(x+x)+', '(a?a)+', '(\\d+\\s*)+', '(\\s*\\d+)+',
    '((a)+)+', '(a*)*', '(a+|b)+', '((a|a)x)+', '^\\w+([.-]?\\w+)*@\\w+([.-]?\\w+)*(\\.\\w{2,3})+$', '(.*,)+',
    '(a|\\1)+', '(\\1+)+', '(-?\\d+)+', '(?:a|a)+', '(?:(?:a+)+)b',
  ])('refuses the ambiguous pattern %s', (pattern) => {
    expect(nestedRepeat(pattern)).toBe(true);
  });

  it('leaves a pattern that does not parse to the RegExp constructor', () => {
    expect(nestedRepeat('(a')).toBe(false);
    expect(nestedRepeat('a)')).toBe(false);
    expect(nestedRepeat('[a')).toBe(false);
  });

  it('lets REGEXMATCH, REGEXEXTRACT and QUERY use e-mail, version and path patterns', () => {
    expect(calc('REGEXMATCH("john.doe@example.com","^\\w+(\\.\\w+)*@\\w+(\\.\\w+)+$")')).toBe(true);
    expect(calc('REGEXMATCH("1.2.3","^\\d+(\\.\\d+)+$")')).toBe(true);
    expect(calc('REGEXEXTRACT("v1.2.3","\\d+(?:\\.\\d+)+")')).toBe('1.2.3');
    expect(calc('REGEXEXTRACT("v1.2.3","\\d+(\\.\\d+)+")')).toBe('.3'); // a capture group is what is extracted
    expect(calc('REGEXMATCH("/usr/local/bin","^(\\/[^\\/]+)+$")')).toBe(true);
    expect(calc('REGEXMATCH("a, b, c","^\\w+(,\\s*\\w+)+$")')).toBe(true);
    expect(calc('QUERY(A1:A2,"select A where A matches \'^\\w+(\\.\\w+)+$\'")', { A1: 'a.b.c', A2: 'abc' })).toBe('a.b.c');
  });

  it('refuses the patterns that would freeze the sheet, without trying them', () => {
    const t0 = performance.now();
    expect(calc('REGEXMATCH(REPT("a",30)&"b","^(a|a)+$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXREPLACE(REPT("a",30)&"b","^(a|a)+$","x")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH(REPT("a",30)&"b","^(a+)+$")')).toEqual({ error: '#VALUE!' });
    expect(calc('QUERY(A1:A2,"select A where A matches \'^(a|a)+$\'")', { A1: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', A2: 'x' })).toHaveProperty('error');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
