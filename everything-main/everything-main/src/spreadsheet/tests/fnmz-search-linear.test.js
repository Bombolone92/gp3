import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// SEARCH uses fixed-width literal comparisons and forward-only wildcard pieces.
// Folded source windows preserve UTF-16 offsets without normalizing the entire
// remaining text again at every candidate position.

const VALUE = { error: '#VALUE!' };

describe('SEARCH', () => {
  it('finds plain and wildcard needles as before, by character', () => {
    expect(calc('SEARCH("b","abc")')).toBe(2);
    expect(calc('SEARCH("B","abc")')).toBe(2);
    expect(calc('SEARCH("c","abc",3)')).toBe(3);
    expect(calc('SEARCH("c","abc",4)')).toEqual(VALUE);
    expect(calc('SEARCH("","abc",2)')).toBe(2);
    expect(calc('SEARCH("zzz","aaa")')).toEqual(VALUE);
    expect(calc('SEARCH("a?c","xxabc")')).toBe(3);
    expect(calc('SEARCH("a*c","xxabc")')).toBe(3);
    expect(calc('SEARCH("a*c","xxab")')).toEqual(VALUE);
    expect(calc('SEARCH("*c","abc")')).toBe(1);
    expect(calc('SEARCH("*zzz","abc")')).toEqual(VALUE);
    expect(calc('SEARCH("*","abc")')).toBe(1);
    expect(calc('SEARCH("~*","a*b")')).toBe(2);
    expect(calc('SEARCH("a~","xa~")')).toBe(2);
    expect(calc('SEARCH("b*d*f","abcdefg")')).toBe(2);
    expect(calc('SEARCH("c*d*f","abcdefg")')).toBe(3);
    expect(calc('SEARCH("b*f*d","abcdefg")')).toEqual(VALUE);
    expect(calc('SEARCH("b","😀b")')).toBe(2);
    expect(calc('SEARCH("😀","a😀")')).toBe(2);
    expect(calc('SEARCH("x?","😀x😀")')).toBe(2);
    expect(calc('SEARCH("é","CAFÉ")')).toBe(4);
    expect(calc('SEARCH("b",REPT("😀",16000)&"b")')).toBe(16001);
  });

  it('finds a needle in a text holding İ, whose lower case is longer than itself', () => {
    const I = String.fromCodePoint(0x130); // the only code point in Unicode that grows in lower case
    expect(calc('SEARCH("b",A1)', { A1: `${I}ab` })).toBe(3);
    expect(calc('SEARCH("B",A1)', { A1: `a${I}b` })).toBe(3);
    expect(calc('SEARCH("i",A1)', { A1: `x${I}` })).toEqual(VALUE); // native SEARCH preserves the accent distinction
    expect(calc('SEARCH("x",A1,2)', { A1: `x${I}x` })).toBe(3);
    expect(calc('SEARCH("zzz",A1)', { A1: `a${I}b` })).toEqual(VALUE);
    expect(calc('SEARCH("b",A1)', { A1: `${I}${I}${I}b` })).toBe(4);
    expect(calc('SEARCH("b",A1)', { A1: `😀${I}b` })).toBe(3);
    expect(calc('SEARCH(UNICHAR(775),A1)', { A1: `a${I}` })).toEqual(VALUE); // the dot İ grew is no character of its own
    expect(calc('SEARCH("a?b",A1)', { A1: `${I}axb` })).toBe(2);
    expect(calc(`FIND("b",A1)`, { A1: `${I}ab` })).toBe(3);
  });

  it('costs a walk of the text, not a walk at every position', { timeout: 60000 }, () => {
    const t = performance.now();
    for (let i = 0; i < 10; i++) {
      expect(calc('SEARCH("zzz",REPT("a",32000))')).toEqual(VALUE);
      expect(calc('SEARCH("b",REPT("😀",16000)&"b")')).toBe(16001);
      expect(calc('SEARCH("a?zzz",REPT("a",32000))')).toEqual(VALUE);
      expect(calc('SEARCH("*zzz",REPT("a",32000))')).toEqual(VALUE);
      expect(calc('SEARCH("a*a*zzz",REPT("a",32000)&"zzz")')).toBe(1);
      // One İ anywhere in the cell once switched the needle to the walk at every position: 5.1 s a call.
      expect(calc('SEARCH("zzz",REPT("a",32000)&UNICHAR(304))')).toEqual(VALUE);
      expect(calc('SEARCH("zzz",UNICHAR(304)&REPT("a",32000)&"zzz")')).toBe(32002);
    }
    // Cutting the remainder at every position cost about 0.2 s per call, 0.4 s over the emoji; a linear walk costs a few milliseconds.
    expect(performance.now() - t).toBeLessThan(800);
  });
});
