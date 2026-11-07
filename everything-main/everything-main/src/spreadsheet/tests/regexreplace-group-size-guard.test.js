import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// REGEXREPLACE measures the result before building it. The group references in the replacement
// stand for the text they matched, so a replacement made of nothing but "$1" is no longer measured
// as zero characters: =REGEXREPLACE(A1,"(a)",B1) with two ordinary cells once built half a billion
// characters, a gigabyte of working set, before the finished string was refused.
// ARRAYTOTEXT counts its pieces as it lists them for the same reason.
const VALUE = { error: '#VALUE!' };

describe('REGEXREPLACE result size', () => {
  it('counts group references against the text they matched', () => {
    expect(calc('REGEXREPLACE(REPT("a",20000),"(a)","$1$1")')).toEqual(VALUE);
    expect(calc('REGEXREPLACE(REPT("a",1000),"(a)",REPT("$1",1000))')).toEqual(VALUE);
    expect(calc('REGEXREPLACE(REPT("a",1000),"(a)",REPT("$0",1000))')).toEqual(VALUE);
    expect(calc('REGEXREPLACE(REPT("ab",16000),"(a)(b)","$2$1$2")')).toEqual(VALUE);
    expect(calc('LEN(REGEXREPLACE(REPT("a",30000),"(a)","$1"))')).toBe(30000);
    expect(calc('LEN(REGEXREPLACE(REPT("a",16383),"(a)","$1$1"))')).toBe(32766);
    expect(calc('REGEXREPLACE(REPT("a",16384),"(a)","$1$1")')).toEqual(VALUE);
  });

  it('refuses it without building it', { timeout: 60000 }, () => {
    const t = performance.now();
    for (let i = 0; i < 5; i++) {
      expect(calc('REGEXREPLACE(REPT("a",6000),"(a)",REPT("$1",6000))')).toEqual(VALUE);
      expect(calc('REGEXREPLACE(REPT("a",6000),"(a)",REPT("$0",6000))')).toEqual(VALUE);
      expect(calc('REGEXREPLACE(REPT("a",6000),"(a)",REPT("-",6000))')).toEqual(VALUE);
    }
    // Building the 36-million-character result first cost about a second and 800 MB a call.
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it('keeps a long result that a group makes short', () => {
    // The whole cell is one match and the group one character, so the result fits although the match does not.
    expect(calc('REGEXREPLACE(REPT("a",32000),"^(a).*$","$1$1")')).toBe('aa');
    expect(calc('LEN(REGEXREPLACE(REPT("a",32000),"^(a+)$","$1"))')).toBe(32000);
    expect(calc('REGEXREPLACE("abc","(b)","[$1]")')).toBe('a[b]c');
    expect(calc('REGEXREPLACE("abc","b","<$0>")')).toBe('a<b>c');
    expect(calc('REGEXREPLACE("a1b2","\\d","$$")')).toBe('a$$b$$');
    expect(calc('REGEXREPLACE("abc","b","$9")')).toBe('a$9c'); // no such group: the text as it was written
    expect(calc('REGEXREPLACE("abc","(b)","$1$9")')).toBe('ab$9c');
  });
});

describe('ARRAYTOTEXT result size', () => {
  it('refuses a list longer than a cell as it is listed', { timeout: 60000 }, () => {
    const a = 'REPT("a",20000)';
    const b = 'REPT("b",20000)';
    expect(calc(`ARRAYTOTEXT(HSTACK(${a},${b}))`)).toEqual(VALUE);
    expect(calc(`ARRAYTOTEXT(HSTACK(${a},${b}),1)`)).toEqual(VALUE);
    expect(calc(`LEN(ARRAYTOTEXT(HSTACK(${a},REPT("b",12765))))`)).toBe(32767);
    const t = performance.now();
    for (let i = 0; i < 5; i++) {
      expect(calc('ARRAYTOTEXT(SEQUENCE(4000,10,10000000,7))')).toEqual(VALUE); // 40,000 values listed
      expect(calc('ARRAYTOTEXT(SEQUENCE(4000,1)&REPT("a",1000))')).toEqual(VALUE); // four million characters of them
    }
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it('lists the values as before', () => {
    expect(calc('ARRAYTOTEXT({1,"a";TRUE,2},1)')).toBe('{1,"a";TRUE,2}');
    expect(calc('ARRAYTOTEXT({1,"a";TRUE,2})')).toBe('1, a, TRUE, 2');
    expect(calc('ARRAYTOTEXT("x")')).toBe('x');
    expect(calc('ARRAYTOTEXT("x",1)')).toBe('{"x"}');
    expect(calc('ARRAYTOTEXT(SEQUENCE(2,2))')).toBe('1, 2, 3, 4');
    expect(calc('ARRAYTOTEXT(SEQUENCE(2,2),1)')).toBe('{1,2;3,4}');
  });
});
