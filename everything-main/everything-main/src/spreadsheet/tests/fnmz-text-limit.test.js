import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// A cell holds at most 32,767 characters; text functions whose result would be longer
// answer #VALUE! (the rule documented for REPT), and never try to build it.
const VALUE = { error: '#VALUE!' };

describe('text results past the cell limit', () => {
  it('SUBSTITUTE refuses a result longer than a cell, before building it', () => {
    expect(calc('LEN(SUBSTITUTE(REPT("a",30000),"a","bb"))')).toEqual(VALUE);
    expect(calc('SUBSTITUTE(REPT("a",32767),"a",REPT("b",32767))')).toEqual(VALUE);
    expect(calc('LEN(SUBSTITUTE(REPT("a",32767),"a","b"))')).toBe(32767);
    expect(calc('LEN(SUBSTITUTE(REPT("ab",10000),"a",""))')).toBe(10000);
    expect(calc('SUBSTITUTE(REPT("a",32767),"a","bb",1)')).toEqual(VALUE);
    expect(calc('LEN(SUBSTITUTE(REPT("a",32766),"a","bb",1))')).toBe(32767);
    expect(calc('LEN(SUBSTITUTE(REPT("a",32767),"a","bb",40000))')).toBe(32767); // no such instance: the text as it was
  });

  it('REPLACE refuses a result longer than a cell', () => {
    expect(calc('REPLACE(REPT("a",30000),1,1,REPT("b",5000))')).toEqual(VALUE);
    expect(calc('LEN(REPLACE(REPT("a",30000),1,5000,REPT("b",5000)))')).toBe(30000);
    expect(calc('LEN(REPLACE(REPT("a",32766),1,0,"b"))')).toBe(32767);
  });

  it('REGEXREPLACE refuses a result longer than a cell, before building it', () => {
    expect(calc('LEN(REGEXREPLACE(REPT("a",30000),"a","bb"))')).toEqual(VALUE);
    expect(calc('REGEXREPLACE(REPT("a",32767),"a",REPT("b",32767))')).toEqual(VALUE);
    expect(calc('REGEXREPLACE(REPT("a",20000),"(a)","$1$1")')).toEqual(VALUE);
    expect(calc('LEN(REGEXREPLACE(REPT("a",30000),"(a)","$1"))')).toBe(30000);
    expect(calc('LEN(REGEXREPLACE(REPT("ab",10000),"a",""))')).toBe(10000);
    expect(calc('LEN(REGEXREPLACE(REPT("a",32767),"a","b"))')).toBe(32767);
    expect(calc('REGEXREPLACE("a1b2","\\d","$$")')).toBe('a$$b$$');
  });

  it('UPPER and LOWER refuse text that grows past a cell when its case changes', () => {
    expect(calc('UPPER(REPT("ß",32767))')).toEqual(VALUE);
    expect(calc('LEN(UPPER(REPT("ß",16383)))')).toBe(32766);
    expect(calc('LOWER(REPT(UNICHAR(304),32767))')).toEqual(VALUE); // İ lowercases to two code points
    expect(calc('UPPER("straße")')).toBe('STRASSE');
  });
});
