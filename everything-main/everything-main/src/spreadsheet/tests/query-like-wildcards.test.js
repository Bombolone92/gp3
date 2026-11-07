import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { runQuery } from '../src/core/formula/query.js';

// `like` was a regular expression with each % as .*: three or more wildcards over a long cell
// backtracked for seconds (600 a's against %a%a%a%b took seven), which a shared file could exploit.
describe('QUERY like', () => {
  const cells = { A1: 'apple', A2: 'Apple pie', A3: 'a.b', A4: 'a(b)', A5: 'a\nb', A6: 'ab' };
  const like = (pattern) => calc(`TEXTJOIN("|",TRUE,QUERY(A1:A6,"select A where A like '${pattern}'"))`, cells);

  it('matches % as any run of characters and _ as exactly one', () => {
    expect(like('%pple')).toBe('apple');
    expect(like('a%')).toBe('apple|a.b|a(b)|a\nb|ab');
    expect(like('a_b')).toBe('a.b|a\nb');
    expect(like('a_b_')).toBe('a(b)');
    expect(like('a__b_')).toBe('');
    expect(like('%')).toBe('apple|Apple pie|a.b|a(b)|a\nb|ab');
    expect(like('ab')).toBe('ab');
    expect(like('%%b')).toBe('a.b|a\nb|ab');
    expect(like('%b%')).toBe('a.b|a(b)|a\nb|ab');
    expect(like('a%p%e')).toBe('apple');
    expect(like('%p%e')).toBe('apple|Apple pie');
  });

  it('is case-sensitive and reads regular-expression characters literally', () => {
    expect(like('apple%')).toBe('apple');
    expect(like('Apple%')).toBe('Apple pie');
    expect(like('a.b')).toBe('a.b');
    expect(like('a(b)')).toBe('a(b)');
    expect(like('%.%')).toBe('a.b');
    expect(like('x%')).toBe('');
  });

  it('answers a pattern of several wildcards over a long cell at once', () => {
    const long = [['k'], ['a'.repeat(20000)], [`${'a'.repeat(19999)}b`]];
    const start = performance.now();
    expect(runQuery(long, "select A where A like '%a%a%a%b'", { headers: 1 }).values).toEqual([['k'], [`${'a'.repeat(19999)}b`]]);
    expect(runQuery(long, "select A where A like '%a%b'", { headers: 1 }).values).toEqual([['k'], [`${'a'.repeat(19999)}b`]]);
    expect(runQuery(long, `select A where A like '${'%a'.repeat(12)}'`, { headers: 1 }).values).toEqual([['k'], ['a'.repeat(20000)]]);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
