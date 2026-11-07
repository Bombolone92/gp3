import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

describe('powers of zero', () => {
  it('make 0^0 #NUM! and 0^-1 #DIV/0!', () => {
    expect(calc('0^0')).toEqual({ error: '#NUM!' });
    expect(calc('0^-1')).toEqual({ error: '#DIV/0!' });
    expect(calc('0^2')).toBe(0);
    expect(calc('2^0')).toBe(1);
    expect(calc('(-8)^(1/3)')).toEqual({ error: '#NUM!' });
    expect(calc('POWER(0,0)')).toEqual({ error: '#NUM!' });
  });
});

describe('implicit intersection of an array without an address', () => {
  it('takes the top-left value', () => {
    expect(calc('@SEQUENCE(3)')).toBe(1);
    expect(calc('@{5,6,7}')).toBe(5);
    expect(calc('@{5;6;7}*2')).toBe(10);
  });
});

describe('a named LAMBDA that calls itself', () => {
  it('recurses as deep as a LET-bound one', async () => {
    const { Workbook } = await import('../src/core/workbook.js');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.defineName('SUMTO', 'LAMBDA(n,IF(n=0,0,n+SUMTO(n-1)))')).toBeNull();
    wb.setInput(id, 0, 0, '=SUMTO(30)');
    wb.setInput(id, 1, 0, '=SUMTO(100)');
    wb.setInput(id, 2, 0, '=LET(f,LAMBDA(n,IF(n=0,0,n+f(n-1))),f(100))');
    expect(wb.getValue(id, 0, 0)).toBe(465);
    expect(wb.getValue(id, 1, 0)).toBe(5050);
    expect(wb.getValue(id, 2, 0)).toBe(5050);
    // A plain name that refers to itself is still a cycle.
    expect(wb.defineName('LOOP', 'LOOP+1')).toBeNull();
    wb.setInput(id, 3, 0, '=LOOP');
    expect(wb.getValue(id, 3, 0)).toEqual({ error: '#CYCLE!' });
  });
});

describe('volatile detection', () => {
  it('sees through a reference union', async () => {
    const { isVolatile } = await import('../src/core/formula/evaluator.js');
    const { parseFormula } = await import('../src/core/formula/parser.js');
    expect(isVolatile(parseFormula('SUM((RAND(),1))'))).toBe(true);
    expect(isVolatile(parseFormula('SUM((A1,B1))'))).toBe(false);
    expect(isVolatile(parseFormula('NOW()+1'))).toBe(true);
  });
});

