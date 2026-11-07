import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';
import { subjectLimit } from '../src/core/formula/regex-safety.js';
import { calc } from './helpers/calc.js';

// QUERY's `matches` checked only whether a pattern's repeats could run for ever, never the length
// of the text it ran them on, which REGEXMATCH and Find both do. A pattern with two overlapping
// repeats, (\w+)\s*(\w+)=, divides a long run of text in every way: it costs seconds on a cell of a
// few thousand characters, once for every row of the query, and one test cannot be interrupted.

const PAIR = '(\\w+)\\s*(\\w+)=';

describe('QUERY matches and the length of the text', () => {
  it('has the same limit for the pattern as the REGEX functions do', () => {
    expect(subjectLimit(PAIR)).toBe(1000);
  });

  it('refuses a cell past the limit instead of running the pattern on it', () => {
    const t0 = performance.now();
    const long = 'a'.repeat(6000);
    const out = runQuery([['text'], [long], ['a b=']], `select A where A matches '${PAIR}'`, { headers: 1 });
    expect(out.error).toBe('#VALUE!');
    expect(out.message).toMatch(/too long/i);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('still filters cells within the limit', () => {
    const out = runQuery([['text'], ['a b='], ['nope'], ['x'.repeat(900)]], `select A where A matches '${PAIR}'`, { headers: 1 });
    expect(out.values).toEqual([['text'], ['a b=']]);
  });

  it('leaves a pattern with no limit alone on the longest cells', () => {
    const long = 'a'.repeat(6000);
    const out = runQuery([['text'], [long], ['abc']], "select A where A matches 'a+'", { headers: 1 });
    expect(out.values).toEqual([['text'], [long]]);
  });

  it('matches what REGEXMATCH answers for the same pattern and text', () => {
    expect(calc(`REGEXMATCH(A1,"${PAIR}")`, { A1: 'a'.repeat(6000) })).toEqual({ error: '#VALUE!' });
    expect(calc(`QUERY(A1:A1,"select A where A matches '${PAIR}'")`, { A1: 'a'.repeat(6000) })).toEqual({ error: '#VALUE!' });
  });
});
