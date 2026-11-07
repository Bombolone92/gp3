import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

// A single-value function handed an array runs once per cell, so the classic
// SUM(LEN(...)), SUMPRODUCT(--(LEFT(...)="a")) and MONTH(dates)=1 idioms work and =LEN(A1:A3) spills.
const D = {
  A1: '-1', A2: '2',
  B1: '1', B2: '2', B3: '3',
  C1: 'abc', C2: 'de', C3: 'a',
  D1: '=DATE(2024,1,15)', D2: '=DATE(2024,2,15)', D3: '=DATE(2023,1,1)',
};
const E = (code) => ({ error: code });

describe('single-value functions over arrays', () => {
  it('lift math functions', () => {
    expect(calc('SUM(ABS(A1:A2))', D)).toBe(3);
    expect(calc('SUM(ROUND(B1:B3/2,0))', D)).toBe(4);
    expect(calc('SUM(INT(B1:B3/2))', D)).toBe(2);
    expect(calc('SUM(SQRT({1,4,9}))')).toBe(6);
    expect(calc('MAX(MOD(B1:B3,2))', D)).toBe(1);
    expect(calc('SUM(POWER(B1:B3,2))', D)).toBe(14);
    expect(calc('SUM(POWER({1,2,3},{2,2,2}))')).toBe(14);
    expect(calc('SUM(N(B1:B3))', D)).toBe(6);
    expect(calc('SUM(-SIGN(A1:A2))', D)).toBe(0);
  });

  it('lift text functions', () => {
    expect(calc('SUM(LEN(C1:C3))', D)).toBe(6);
    expect(calc('SUMPRODUCT(--(LEFT(C1:C3,1)="a"))', D)).toBe(2);
    expect(calc('SUM(--(UPPER(C1:C3)="A"))', D)).toBe(1);
    expect(calc('TEXTJOIN(",",1,TEXT(B1:B3,"0.0"))', D)).toBe('1.0,2.0,3.0');
    expect(calc('TEXTJOIN("|",1,SUBSTITUTE(C1:C3,"a","x"))', D)).toBe('xbc|de|x');
    expect(calc('SUM(--ISNUMBER(SEARCH("a",C1:C3)))', D)).toBe(2);
    expect(calc('TEXTJOIN(",",1,REPT("-",B1:B3))', D)).toBe('-,--,---');
  });

  it('lift date functions and logical NOT', () => {
    expect(calc('SUM(YEAR(D1:D3))', D)).toBe(6071);
    expect(calc('SUMPRODUCT(--(MONTH(D1:D3)=1))', D)).toBe(2);
    expect(calc('SUMPRODUCT(MONTH(D1:D3)=1)', D)).not.toHaveProperty('error');
    expect(calc('SUM(DATE(2024,{1,2},1)-DATE(2024,1,1))')).toBe(31);
    expect(calc('SUM(--NOT(B1:B3>1))', D)).toBe(1);
    expect(calc('SUM(DAYS(D2:D3,D1))', D)).toBe(31 - 379);
  });

  it('pair arrays like the operators do: single rows or columns stretch, cells without a partner are #N/A', () => {
    expect(calc('INDEX(LEFT({"ab","cd","ef"},{1,2}),1,2)')).toBe('cd');
    expect(calc('INDEX(LEFT({"ab","cd","ef"},{1,2}),1,3)')).toEqual(E('#N/A'));
    expect(calc('ROWS(LEFT({"ab";"cd"},{1,2}))')).toBe(2);
    expect(calc('COLUMNS(LEFT({"ab";"cd"},{1,2}))')).toBe(2);
    expect(calc('INDEX(LEFT({"ab";"cd"},{1,2}),2,2)')).toBe('cd');
  });

  it('keep errors per cell so IFERROR can patch them', () => {
    expect(calc('SUM(IFERROR(SQRT({4,-1,9}),0))')).toBe(5);
    expect(calc('SUM(IFERROR(VALUE({"1","x","3"}),0))')).toBe(4);
    expect(calc('SUM(IFERROR(N({1,#N/A,3}),0))')).toBe(4); // N inspects errors itself
  });

  it('leave single cells, aggregates and range functions as they were', () => {
    expect(calc('LEN(C1)', D)).toBe(3);
    expect(calc('LEN(C1:C1)', D)).toBe(3);
    expect(calc('LEN(C1:C3)', D)).toBe(3); // collapses to its first cell in a scalar context, as before
    expect(calc('SUM(A1:A2)', D)).toBe(1);
    expect(calc('ROWS(LEN(C1:C3))', D)).toBe(3);
    expect(calc('COUNT(LEN(C1:C3))', D)).toBe(3);
    expect(calc('INDEX(LEN(C1:C3),2)', D)).toBe(2);
    expect(calc('ROWS(ABS(SEQUENCE(1000)))')).toBe(1000);
  });

  it('lift a built-in called through a name too', () => {
    expect(calc('LET(f,LEN,SUM(f(C1:C3)))', D)).toBe(6);
    expect(calc('SUM(MAP(C1:C3,LEN))', D)).toBe(6);
  });

  it('spill =LEN(A1:A3) like =A1:A3*1', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'abc');
    wb.setInput(id, 1, 0, 'de');
    wb.setInput(id, 2, 0, 'a');
    wb.setInput(id, 0, 2, '=LEN(A1:A3)');
    wb.setInput(id, 0, 3, '=ROUND(LEN(A1:A3)/2,0)');
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 2))).toEqual([3, 2, 1]);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 3))).toEqual([2, 1, 1]);
    wb.setInput(id, 0, 4, '=LEN(A1)');
    expect(wb.getValue(id, 0, 4)).toBe(3);
    expect(wb.getValue(id, 1, 4)).toBeNull();
  });
});
