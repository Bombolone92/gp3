import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// A pattern with two overlapping unbounded repeats, tried from every position of a long cell,
// costs the cube of the text's length: a sixth of a second at a thousand characters and hours
// at the longest cell. The REGEX functions hold such a pattern's text to subjectLimit (a
// thousand characters) and answer a longer one #VALUE! without trying the pattern.
const pattern = '(\\w+)\\s*(\\w+)=';
const E = (code) => ({ error: code });

describe('REGEX functions and a pattern with two overlapping repeats', () => {
  it('answer #VALUE! at once for a text longer than a thousand characters', () => {
    const long = { A1: 'a'.repeat(1200) };
    const t0 = performance.now();
    expect(calc(`REGEXMATCH(A1,"${pattern}")`, long)).toEqual(E('#VALUE!'));
    expect(calc(`REGEXTEST(A1,"${pattern}")`, long)).toEqual(E('#VALUE!'));
    expect(calc(`REGEXEXTRACT(A1,"${pattern}")`, long)).toEqual(E('#VALUE!'));
    expect(calc(`REGEXREPLACE(A1,"${pattern}","x")`, long)).toEqual(E('#VALUE!'));
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('still try the pattern on a text within the limit', () => {
    expect(calc(`REGEXMATCH(A1,"${pattern}")`, { A1: 'a'.repeat(900) })).toBe(false); // no = to match
    expect(calc(`REGEXMATCH(A1,"${pattern}")`, { A1: `${'a'.repeat(900)} b=` })).toBe(true);
    expect(calc(`ARRAYTOTEXT(REGEXEXTRACT("ab cd=","${pattern}"),1)`)).toBe('{"ab","cd"}');
    expect(calc(`REGEXREPLACE("ab cd=","${pattern}","$2")`)).toBe('cd');
  });

  it('keep patterns without the cost working on the longest cells', () => {
    expect(calc('REGEXMATCH(REPT("a",32000),"a+b")')).toBe(false);
    expect(calc('REGEXMATCH(REPT("a",32000)&"b","a+b")')).toBe(true);
    expect(calc('LEN(REGEXREPLACE(REPT("a",32000),"a","b"))')).toBe(32000);
    expect(calc('REGEXEXTRACT(REPT("a",32000)&"7","\\d")')).toBe('7');
    // Anchored to the start, the pattern is tried from one position: no limit.
    expect(calc('REGEXMATCH(REPT("a",2000),"^a*a*b")')).toBe(false);
  });
});
