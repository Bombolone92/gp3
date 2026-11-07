import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { signatureFor } from '../src/core/formula/hints.js';

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
}

const E = (code) => ({ error: code });

// Signature: TEXTBEFORE/TEXTAFTER(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found]).
describe('TEXTBEFORE and TEXTAFTER options', () => {
  it('match the delimiter regardless of case when match_mode is 1', () => {
    expect(calc('TEXTBEFORE("abcABC","B")')).toBe('abcA');
    expect(calc('TEXTBEFORE("abcABC","B",1,1)')).toBe('a');
    expect(calc('TEXTBEFORE("abcABC","B",,FALSE)')).toBe('abcA');
    expect(calc('TEXTAFTER("abcABC","B",1,1)')).toBe('cABC');
    expect(calc('TEXTAFTER("abcABC","B",-1,1)')).toBe('C');
    expect(calc('TEXTBEFORE("abc","b",1,2)')).toEqual(E('#VALUE!'));
  });

  it('treat the end of the text as a delimiter when match_end is 1', () => {
    expect(calc('TEXTBEFORE("abc","x",1,0,1)')).toBe('abc');
    expect(calc('TEXTAFTER("abc","x",1,0,1)')).toBe('');
    expect(calc('TEXTBEFORE("a-b","-",2,,1)')).toBe('a-b');
    expect(calc('TEXTAFTER("a-b","-",2,,1)')).toBe('');
    expect(calc('TEXTBEFORE("a-b","-",1,,1)')).toBe('a');
    expect(calc('TEXTBEFORE("abc","x",1,0,0)')).toEqual(E('#N/A'));
    expect(calc('TEXTBEFORE("abc","x",1,0,2)')).toEqual(E('#VALUE!'));
  });

  it('treat the start of the text as a delimiter when match_end is 1 and the instance counts from the end', () => {
    expect(calc('TEXTAFTER("abc","x",-1,,1)')).toBe('abc');
    expect(calc('TEXTBEFORE("abc","x",-1,,1)')).toBe('');
    expect(calc('TEXTAFTER("a-b","-",-2,,1)')).toBe('a-b');
    expect(calc('TEXTAFTER("a-b","-",-1,,1)')).toBe('b');
  });

  it('answer if_not_found instead of #N/A when the delimiter is missing', () => {
    expect(calc('TEXTBEFORE("abc","x",1,0,0,"nf")')).toBe('nf');
    expect(calc('TEXTAFTER("abc","x",,,,"nf")')).toBe('nf');
    expect(calc('TEXTBEFORE("a-b","-",3,,,"nf")')).toBe('nf');
    expect(calc('TEXTAFTER("a-b","-",-3,,,0)')).toBe(0);
    expect(calc('TEXTBEFORE("a-b","-",3)')).toEqual(E('#N/A'));
  });

  it('give #VALUE! for instance 0 or an instance beyond the length of the text', () => {
    expect(calc('TEXTBEFORE("a-b-c","-",0)')).toEqual(E('#VALUE!'));
    expect(calc('TEXTAFTER("a-b-c","-",0)')).toEqual(E('#VALUE!'));
    expect(calc('TEXTBEFORE("abc","x",5)')).toEqual(E('#VALUE!'));
    expect(calc('TEXTBEFORE("abcdef","x",2)')).toEqual(E('#N/A'));
    expect(calc('TEXTBEFORE("abc","x",5,,,"nf")')).toEqual(E('#VALUE!'));
  });

  it('accept any delimiter of an array constant', () => {
    expect(calc('TEXTBEFORE("a,b;c",{",",";"},2)')).toBe('a,b');
    expect(calc('TEXTAFTER("a,b;c",{",",";"},-1)')).toBe('c');
    expect(calc('TEXTAFTER("a,b;c",{",",";"})')).toBe('b;c');
    expect(calc('TEXTBEFORE("a<>b<c",{"<","<>"},2)')).toBe('a<>b');
  });

  it('keep the empty text and empty delimiter rules', () => {
    expect(calc('TEXTBEFORE("","x")')).toBe('');
    expect(calc('TEXTAFTER("","x")')).toBe('');
    expect(calc('TEXTBEFORE("abc","")')).toBe('');
    expect(calc('TEXTBEFORE("abc","",-1)')).toBe('abc');
    expect(calc('TEXTAFTER("abc","")')).toBe('abc');
    expect(calc('TEXTAFTER("abc","",-1)')).toBe('');
  });

  it('advertise the full signatures', () => {
    expect(signatureFor('TEXTBEFORE').params).toBe('text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found]');
    expect(signatureFor('TEXTAFTER').params).toBe('text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found]');
  });
});
