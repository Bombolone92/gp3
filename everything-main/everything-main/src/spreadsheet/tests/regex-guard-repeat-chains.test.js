import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat, subjectLimit } from '../src/core/formula/regex-safety.js';

// A part that must match something closed the choices before it, so \d+\d+\d+x and a*a+a*b passed
// the guard although they divide a run of digits or a's three ways just as \d*\d*\d*x does, and took
// seconds on a 300-character cell. Two overlapping repeats stay allowed, but tried from every
// position of a long cell they cost the cube of its length, so the pattern carries a length limit.
describe('the nested-repeat guard on chains of repeats through parts that must match', () => {
  it.each(['\\d+\\d+\\d+x', 'a*a+a*b', 'a+a+a+b', '(\\w+)(\\w+)(\\w+)=', 'a*aa*a*b', '\\w+\\w*\\w+!', 'a*[ab]a*a*x', 'a*a*a*a*b'])
    ('refuses three overlapping repeats in a row %s', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(true);
    });

  it.each(['^\\d+\\d+\\d+$', '^a*a*a*b', '^\\w+\\w+\\w+$'])
    ('holds %s, anchored, to a thousand characters instead of refusing it', (pattern) => {
      // From one starting position three open parts divide the text in the square of its length rather
      // than the cube: ^\d+\d+\d+$ costs a quarter of a second on the thousand characters it is held to,
      // where \d+\d+\d+x, tried from every position, costs six minutes. A fourth part is the cube again.
      expect(nestedRepeat(pattern)).toBe(false);
      expect(subjectLimit(pattern)).toBe(1000);
    });

  it.each(['^\\d+\\d+\\d+\\d+$', '^a*a*a*a*b', '^(.*?)a(.*?)b(.*?)c(.*)$'])
    ('refuses a fourth overlapping part, %s, anchored or not', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(true);
      expect(nestedRepeat(pattern.slice(1))).toBe(true);
    });

  it.each(['\\d+\\d+x', 'a+a+b', 'a*a*b', 'a*b+a*a*c', 'a?a*a*b', 'a*a*a?b', 'a?a+a*b', '^(https?:\\/\\/)?([\\w-]+\\.)+[\\w-]+$',
    '\\d+\\.\\d+\\.\\d+', '(\\w+)\\s*(\\w+)=', '[+-]?\\d+(\\.\\d+)?', '^\\s*-?\\d*\\.?\\d*\\s*$'])
    ('allows %s, where a run is divided at most two ways or by a constant', (pattern) => {
      expect(nestedRepeat(pattern)).toBe(false);
      expect(() => new RegExp(pattern, 'u')).not.toThrow();
    });

  it('answers #VALUE! from REGEXMATCH without trying the pattern', () => {
    const t0 = performance.now();
    expect(calc('REGEXMATCH(REPT("1",300),"\\d+\\d+\\d+x")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH(REPT("a",300),"a*a+a*b")')).toEqual({ error: '#VALUE!' });
    expect(calc('REGEXMATCH("12x","\\d+\\d+x")')).toBe(true);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('the length limit for a pattern with two overlapping repeats', () => {
  it.each(['a*a*b', 'a+a+b', '.*.*=', '(\\w+)\\s*(\\w+)=', '(\\d+)?\\s*(\\w+)?', '\\d*\\.?\\d*', '[a-z]*[a-z0-9]*x', 'a|a*a*b', '(?=a*a*)b'])
    ('holds %s, tried from every position, to a thousand characters', (pattern) => {
      expect(subjectLimit(pattern)).toBe(1000);
    });

  it.each(['^a*a*b', '^\\d+\\d+x$', '^a*a*b|^c*c*d', 'a*b', '.*cado', 'a+b+', '\\d+\\.\\d+', '(\\.\\w+)+', '^\\s*-?\\d*\\.?\\d*\\s*$', 'abc', '',
    '(a+)+', '(a'])
    ('sets no limit for %s, anchored, with one repeat at a time, refused or unparsable', (pattern) => {
      expect(subjectLimit(pattern)).toBe(Infinity);
    });

  it('keeps such a pattern under about a second at its limit', () => {
    const t0 = performance.now();
    new RegExp('(\\w+)\\s*(\\w+)=').test('a'.repeat(subjectLimit('(\\w+)\\s*(\\w+)=')));
    new RegExp('a*a*b').test('a'.repeat(subjectLimit('a*a*b')));
    expect(performance.now() - t0).toBeLessThan(6000);
  });
});
