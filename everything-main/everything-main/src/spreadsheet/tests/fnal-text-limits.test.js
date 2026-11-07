import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

describe('BASE min_length', () => {
  // BASE documents min_length as an integer from 0 to 255 and answers #NUM! outside it;
  // an unbounded width let =BASE(10,2,300000000) build a 300 MB string.
  it('pads to at most 255 characters and answers #NUM! beyond', () => {
    expect(calc('BASE(10,2,255)')).toBe(`${'0'.repeat(251)}1010`);
    expect(calc('BASE(10,2,255.9)')).toBe(`${'0'.repeat(251)}1010`); // truncated, as every numeric argument is
    expect(calc('BASE(10,2,256)')).toEqual(E('#NUM!'));
    expect(calc('BASE(10,2,300000000)')).toEqual(E('#NUM!'));
    expect(calc('BASE(10,2,-1)')).toEqual(E('#NUM!'));
    expect(calc('BASE(15,2,8)')).toBe('00001111');
  });
});

describe('text past the cell limit', () => {
  // A cell holds at most 32,767 characters; CONCAT, TEXTJOIN and & answer #VALUE! beyond
  // that, and the other text builders must not hand back a longer string.
  const a = 'REPT("a",20000)';
  const b = 'REPT("b",20000)';

  it('JOIN answers #VALUE! when the joined text would not fit a cell', () => {
    expect(calc(`JOIN("",${a},${b})`)).toEqual(E('#VALUE!'));
    expect(calc(`JOIN("-",${a},"x")`)).toBe(`${'a'.repeat(20000)}-x`);
    expect(calc(`LEN(JOIN("",${a},REPT("b",12767)))`)).toBe(32767);
    expect(calc(`JOIN("",${a},REPT("b",12768))`)).toEqual(E('#VALUE!'));
  });

  it('ENCODEURL answers #VALUE! when the escaped text would not fit a cell', () => {
    expect(calc('ENCODEURL(REPT(" ",20000))')).toEqual(E('#VALUE!')); // every space becomes %20
    expect(calc('LEN(ENCODEURL(REPT(" ",10922)))')).toBe(32766);
    expect(calc('ENCODEURL("a b&c/d")')).toBe('a%20b%26c%2Fd');
  });

  it('ARRAYTOTEXT answers #VALUE! when the listed values would not fit a cell', () => {
    expect(calc(`ARRAYTOTEXT(HSTACK(${a},${b}))`)).toEqual(E('#VALUE!'));
    expect(calc(`ARRAYTOTEXT(HSTACK(${a},${b}),1)`)).toEqual(E('#VALUE!'));
    expect(calc(`LEN(ARRAYTOTEXT(HSTACK(${a},REPT("b",12765))))`)).toBe(32767);
    expect(calc('ARRAYTOTEXT({1,"a";TRUE,2},1)')).toBe('{1,"a";TRUE,2}');
  });
});
