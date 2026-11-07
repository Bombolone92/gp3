import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// Native Excel 16.113 uses UTF-16 wildcard units in both Compatibility Versions.
// Version 2 SEARCH starts only on code-point boundaries and returns character
// positions, but each ? still consumes one UTF-16 unit. See the native controls
// in fixtures/reference-calculation-compatibility.json.
const cells = { A1: '😀', A2: 'ab', A3: '😀x', B1: '1', B2: '2', B3: '4' };

describe('? in a wildcard', () => {
  it('consumes one UTF-16 unit in conditional aggregates', () => {
    expect(calc('COUNTIF(A1:A3,"?")', cells)).toBe(0);
    expect(calc('COUNTIF(A1:A3,"??")', cells)).toBe(2); // "ab" and the emoji alone
    expect(calc('COUNTIF(A1:A3,"?x")', cells)).toBe(0);
    expect(calc('COUNTIF(A1:A3,"??x")', cells)).toBe(1);
    expect(calc('SUMIF(A1:A3,"?",B1:B3)', cells)).toBe(0);
    expect(calc('SUMIFS(B1:B3,A1:A3,"??x")', cells)).toBe(4);
    expect(calc('COUNTIFS(A1:A3,"??",B1:B3,">0")', cells)).toBe(2);
    expect(calc('AVERAGEIF(A1:A3,"?",B1:B3)', cells)).toEqual({ error: '#DIV/0!' });
  });

  it('uses UTF-16 units in lookups and Unicode starting positions in SEARCH', () => {
    expect(calc('MATCH("?",A1:A3,0)', cells)).toEqual({ error: '#N/A' });
    expect(calc('MATCH("??",A1:A3,0)', cells)).toBe(1);
    expect(calc('XMATCH("??",A1:A3,2)', cells)).toBe(1);
    expect(calc('XLOOKUP("??x",A1:A3,B1:B3,,2)', cells)).toBe(4);
    expect(calc('SEARCH("?x",A3)', cells)).toEqual({ error: '#VALUE!' });
    expect(calc('SEARCH("??x",A3)', cells)).toBe(1);
    expect(calc('MID(A3,SEARCH("??x",A3),1)', cells)).toBe('😀'); // the returned position is still a character position
    expect(calc('VLOOKUP("??",A1:B3,2,FALSE)', cells)).toBe(1);
  });

  it('leaves plain text, stars and escapes as they were', () => {
    expect(calc('COUNTIF(A1:A3,"a?")', cells)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"*x")', cells)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"*")', cells)).toBe(3);
    expect(calc('COUNTIF(A1:A3,"~?")', { ...cells, A2: '?' })).toBe(1);
    expect(calc('SEARCH("a?","xabc")')).toBe(2);
    expect(calc('SEARCH("a*c","xxabc")')).toBe(3);
    expect(calc('SEARCH("*","abc")')).toBe(1);
    expect(calc('COUNTIF(A1:A3,"?B")', { ...cells, A2: 'ab' })).toBe(1); // case-insensitive, as before
  });

  it('counts an astral literal as two UTF-16 units', () => {
    const emoji = { A1: '😀', A2: '😀😀', A3: 'x😀' };
    expect(calc('COUNTIF(A1:A3,"😀?")', emoji)).toBe(0);
    expect(calc('COUNTIF(A1:A3,"?😀")', emoji)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"😀")', emoji)).toBe(1);
    expect(calc('SEARCH("?😀",A3)', emoji)).toBe(1);
  });
});
