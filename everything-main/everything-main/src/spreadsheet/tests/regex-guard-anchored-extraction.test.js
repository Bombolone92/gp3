import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { nestedRepeat, subjectLimit } from '../src/core/formula/regex-safety.js';
import { compilePattern, patternSubjectLimit } from '../src/core/search.js';

// Three open parts in a row cost the cube of the text's length from every starting position, which is
// refused; but anchored to the start the pattern is tried from one position and stays within the
// square, which the thousand-character limit of a pair already contains. The commonest extraction
// idioms brought from Sheets — ^(.*?):\s*(.*)$, the standard trim, ^(.*?)\s+(.*)$ — were #VALUE! for
// every input, however short, with nothing for the user to act on. Unanchored, and a fourth open part
// anchored or not, are refused as before.
const VALUE = { error: '#VALUE!' };

describe('the ReDoS guard and an anchored chain of open parts', () => {
  it('runs the anchored extraction idioms', () => {
    expect(calc('INDEX(REGEXEXTRACT("key: value","^(.*?):\\s*(.*)$"),1,1)')).toBe('key');
    expect(calc('INDEX(REGEXEXTRACT("key: value","^(.*?):\\s*(.*)$"),1,2)')).toBe('value');
    expect(calc('REGEXREPLACE("  hi  ","^\\s*(.*?)\\s*$","$1")')).toBe('hi');
    expect(calc('REGEXMATCH("John Smith","^(.*?)\\s+(.*)$")')).toBe(true);
    expect(calc('INDEX(REGEXEXTRACT("John Smith","^(.*?)\\s+(.*)$"),1,2)')).toBe('Smith');
    expect(calc('REGEXMATCH("nocolon","^(.*?):\\s*(.*)$")')).toBe(false);
    expect(calc('INDEX(REGEXEXTRACT("a, b","^(.*?),\\s*(.*)$"),1,2)')).toBe('b');
  });

  it('holds them to the thousand characters a pair of open parts is held to', () => {
    expect(calc('LEN(REGEXREPLACE(A1,"^\\s*(.*?)\\s*$","$1"))', { A1: `  ${'a'.repeat(900)}  ` })).toBe(900);
    expect(calc('REGEXREPLACE(A1,"^\\s*(.*?)\\s*$","$1")', { A1: 'a'.repeat(1001) })).toEqual(VALUE);
    expect(calc('REGEXMATCH(A1,"^(.*?):\\s*(.*)$")', { A1: 'a'.repeat(1001) })).toEqual(VALUE);
    expect(calc('REGEXMATCH(A1,"^(.*?):\\s*(.*)$")', { A1: 'a'.repeat(999) })).toBe(false);
    expect(subjectLimit('^(.*?):\\s*(.*)$')).toBe(1000);
    expect(subjectLimit('^\\s*(.*?)\\s*$')).toBe(1000);
    expect(subjectLimit('^(.*?)\\s+(.*)$')).toBe(1000);
    expect(subjectLimit('(\\w+)\\s*(\\w+)=')).toBe(1000); // the unanchored pair, as before
    expect(subjectLimit('^\\d{4}-\\d{2}-\\d{2}$')).toBe(Infinity);
  });

  it('still refuses the same chain unanchored, and a fourth open part anchored', () => {
    for (const pattern of ['(.*?)\\s*,\\s*(.*)', '\\s*([^,]*?)\\s*(,|$)', '\\d+\\s*\\w+\\s*\\d+', '(.*)\\s+-\\s+(.*)',
      'a*a*a*b', 'a?a?a?b', '^(.*?)a(.*?)b(.*?)c(.*)$', '^(.*)(.*)(.*)(.*)$', '^a*a*a*a*b',
      '(a+)+b', '(\\w+\\s?)*x', '(x|y+)+', '(a|a)+', '(x+x)+']) {
      expect(nestedRepeat(pattern)).toBe(true);
      expect(calc(`REGEXMATCH("ab","${pattern}")`)).toEqual(VALUE);
    }
  });

  it('costs milliseconds at the limit, where the cube would cost minutes', { timeout: 60000 }, () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      expect(calc('LEN(REGEXREPLACE(A1,"^\\s*(.*?)\\s*$","$1"))', { A1: ' '.repeat(1000) })).toBe(0);
      expect(calc('REGEXMATCH(A1,"^(.*?):\\s*(.*)$")', { A1: ' '.repeat(1000) })).toBe(false);
      expect(calc('REGEXMATCH(A1,"^(.*?):\\s*(.*)$")', { A1: `${':'.repeat(500)}${'\n'.repeat(500)}` })).toBe(true);
      expect(calc('REGEXMATCH(A1,"(?m)^(.*?)\\s+(.*)$")', { A1: 'a b\n'.repeat(250) })).toBe(true);
    }
    // The same chain from every starting position costs the cube: \d+\d+\d+x takes six minutes on a
    // thousand characters, which is why it stays refused, and ^\d+\d+\d+$ a quarter of a second.
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('lets the find bar and QUERY run them too, on the texts the limit allows', () => {
    expect(compilePattern('^(.*?):\\s*(.*)$')).not.toBeNull();
    expect(compilePattern('^\\s*(.*?)\\s*$')).not.toBeNull();
    expect(compilePattern('(.*)\\s+-\\s+(.*)')).toBeNull();
    expect(patternSubjectLimit('^(.*?):\\s*(.*)$')).toBe(1000);
    expect(calc('QUERY(A1:A2,"select A where A matches \'^(.*?):\\s*(.*)$\'")', { A1: 'key: value', A2: 'plain' })).toBe('key: value');
  });
});
