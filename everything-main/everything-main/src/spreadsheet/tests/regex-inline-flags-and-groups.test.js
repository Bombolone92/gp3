import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 9, `=${formula}`);
  return { wb, id };
}
const calc = (formula) => { const { wb, id } = book(formula); return wb.getValue(id, 0, 9); };
const arr = (formula) => {
  const { wb, id } = book(formula);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
};

describe('RE2 inline flags', () => {
  it('reads a leading (?i) as case-insensitive matching', () => {
    expect(calc('REGEXMATCH("abc","(?i)B")')).toBe(true);
    expect(calc('REGEXMATCH("abc","B")')).toBe(false);
    expect(calc('REGEXREPLACE("abc","(?i)B","x")')).toBe('axc');
    expect(calc('REGEXEXTRACT("abc","(?i)B")')).toBe('b');
  });

  it('reads (?s) as dot-matches-newline and (?m) as line anchors', () => {
    expect(calc('REGEXMATCH("a"&CHAR(10)&"c","(?s)a.c")')).toBe(true);
    expect(calc('REGEXMATCH("a"&CHAR(10)&"c","a.c")')).toBe(false);
    expect(calc('REGEXMATCH("ab"&CHAR(10)&"cd","(?m)^cd$")')).toBe(true);
    expect(calc('REGEXMATCH("ab"&CHAR(10)&"cd","^cd$")')).toBe(false);
  });

  it('accepts combined and repeated flag groups, and still rejects flags it cannot honour', () => {
    expect(calc('REGEXMATCH("A"&CHAR(10)&"c","(?is)a.C")')).toBe(true);
    expect(calc('REGEXMATCH("abc","(?i)(?s)B")')).toBe(true);
    expect(calc('REGEXMATCH("abc","(?U)b")')).toEqual({ error: '#VALUE!' });
  });
});

describe('REGEXEXTRACT capture groups', () => {
  it('returns every capture group as a row', () => {
    expect(arr('REGEXEXTRACT("abc-123","(\\w+)-(\\d+)")')).toEqual([['abc', '123']]);
    expect(arr('REGEXEXTRACT("You can also extract multiple values from text.","You can also (\\w+) multiple (\\w+) from text.")')).toEqual([['extract', 'values']]);
    expect(arr('REGEXEXTRACT("ab","(a)(x)?(b)")')).toEqual([['a', '', 'b']]);
    expect(calc('INDEX(REGEXEXTRACT("abc-123","(\\w+)-(\\d+)"),1,2)')).toBe('123');
  });

  it('keeps a single group as its text and no group as the whole match', () => {
    expect(calc('REGEXEXTRACT("a=b","(\\w)=")')).toBe('a');
    expect(calc('REGEXEXTRACT("order #4521 shipped","\\d+")')).toBe('4521');
    expect(calc('REGEXEXTRACT("abc","\\d")')).toEqual({ error: '#N/A' });
    expect(calc('REGEXEXTRACT("abc","(?:a)(b)")')).toBe('b');
  });
});
