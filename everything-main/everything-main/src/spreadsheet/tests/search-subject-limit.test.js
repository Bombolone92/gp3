import { describe, expect, it } from 'vitest';
import { cellMatches, patternSubjectLimit, replaceInText } from '../src/core/search.js';

// A pattern with two overlapping repeats in a row costs the cube of a cell's length when the cell
// does not match, and one regular-expression test cannot be interrupted, so the search's time budget
// never gets its turn on a long cell. Such a pattern skips cells longer than its limit; every other
// pattern, and a whole-cell match anchored at both ends, keeps searching cells of any length.
describe('the longest cell a regular expression is tried on', () => {
  const cubic = 'a+a+b';
  const cell = (text) => ({ v: text, f: null });

  it('skips a cell longer than the pattern allows, in no time', () => {
    const limit = patternSubjectLimit(cubic);
    expect(limit).toBe(1000);
    const long = 'a'.repeat(limit + 200);
    const t0 = performance.now();
    expect(cellMatches(cell(long), long, cubic, { regex: true })).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(replaceInText(long, cubic, 'x', { regex: true })).toBeNull();
  });

  it('still searches cells within the limit', () => {
    const text = `${'a'.repeat(500)}b`;
    expect(cellMatches(cell(text), text, cubic, { regex: true })).toBe(true);
    expect(replaceInText('aab', cubic, 'x', { regex: true })).toBe('x');
  });

  it('gives an ordinary pattern, and a whole-cell match, no limit', () => {
    expect(patternSubjectLimit('a+b')).toBe(Infinity);
    expect(patternSubjectLimit(cubic, { wholeCell: true })).toBe(Infinity);
    const long = `${'a'.repeat(5000)}b`;
    expect(cellMatches(cell(long), long, 'a+b', { regex: true })).toBe(true);
    expect(cellMatches(cell(long), long, cubic, { regex: true, wholeCell: true })).toBe(true);
  });
});
