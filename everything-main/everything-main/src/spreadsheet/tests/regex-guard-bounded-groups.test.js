import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat, subjectLimit } from '../src/core/formula/regex-safety.js';
import { runQuery } from '../src/core/formula/query.js';

// The guard took every {n} repeat of a group, n from 3 up, for an unbounded one, and refused the
// standard IPv4 pattern: its octet alternatives share a first character and 1?\d?\d holds two open
// parts, which would let an unbounded repeat divide the text in ever more ways. Repeated three
// times over a body at most four characters long the octets are tried at most 6³ = 216 ways
// whatever the text's length, so the pattern is linear and accepted; (a|ab){10}, (a{0,2}){20} and
// every unbounded-body repeat stay refused, and a chain of such groups still counts as open parts.

const IPV4 = '^(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)$';

describe('the nested-repeat guard on a bounded group repeated a few times', () => {
  it.each([
    IPV4,
    '^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$',
    '^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$',
    '(?:1?\\d?\\d\\.){3}', '^(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$', '(a|ab){8}', '(a|a){3}', '^(\\d{1,3}\\.){3}\\d{1,3}$',
  ])('allows %s, which divides the text a bounded number of ways', (pattern) => {
    expect(nestedRepeat(pattern)).toBe(false);
    expect(subjectLimit(pattern)).toBe(Infinity);
    expect(() => new RegExp(pattern, 'u')).not.toThrow();
  });

  it.each([
    '(?:1?\\d?\\d\\.)+', '(a|ab){9}', '(a|ab){10}', '^(a{0,2}){20}b$', '^(a?b?){20}c$', '^(\\w{0,3}){15}!$',
    '(.*a){14}', '^(.*a){3}$', '(\\w+\\s?){5}x', '^(a+){6}b$', '((a+)+){2}', '(x+x){3}',
    '((a|ab){3})+', '(?:(a|ab){3}){10}', '(a|ab){3}(a|ab){3}(a|ab){3}', '(a|ab){3}a*a*b',
  ])('still refuses %s', (pattern) => {
    expect(nestedRepeat(pattern)).toBe(true);
  });

  it('lets REGEXMATCH, REGEXEXTRACT and QUERY use the IPv4 pattern', () => {
    expect(calc(`REGEXMATCH("192.168.1.1","${IPV4}")`)).toBe(true);
    expect(calc(`REGEXMATCH("10.0.0.255","${IPV4}")`)).toBe(true);
    expect(calc(`REGEXMATCH("256.1.1.1","${IPV4}")`)).toBe(false);
    expect(calc(`REGEXMATCH("1.2.3","${IPV4}")`)).toBe(false);
    expect(calc(`REGEXMATCH(REPT("1.",10000)&"1","${IPV4}")`)).toBe(false); // 20,001 characters, tried from the start alone
    expect(calc('REGEXEXTRACT("host 10.1.2.3 up","(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)")')).toBe('10.1.2.3');
    const rows = runQuery([['ip'], ['192.168.1.1'], ['nope'], ['8.8.8.8']], `select A where A matches '${IPV4.slice(1, -1)}'`, { headers: 1 });
    expect(rows.values).toEqual([['ip'], ['192.168.1.1'], ['8.8.8.8']]);
  });

  it('answers #VALUE! for the refused patterns without trying them', () => {
    const t0 = performance.now();
    expect(calc('REGEXMATCH(REPT("a",30)&"!","^(a|ab){10}$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH(REPT("a",40)&"!","^(a{0,2}){20}b$")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH(REPT("1.",60),"^(?:1?\\d?\\d\\.)+x$")')).toEqual({ error: '#VALUE!' });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
