import { expect, it } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { calc } from './helpers/calc.js';

const trim = (values, rows, columns) => FUNCTIONS.TRIMRANGE.fn([{ range: true, values }, rows, columns]);
it('retains empty text on each boundary while trimming genuinely blank cells', () => {
  expect(trim([[null,null,null,null],[null,'',1,null],[null,2,'',null],[null,null,null,null]]))
    .toEqual({ range: true, values: [['',1],[2,'']] });
  expect(trim([[null],[''],[null]])).toEqual({ range: true, values: [['']] });
  expect(trim([['','']])).toEqual({ range: true, values: [['','']] });
  expect(trim([[null],[null]])).toEqual({ error: '#CALC!' });
});
it.each([0,1,2,3])('retains empty text with trim direction %s', direction => {
  expect(trim([['',null],[null,'']],direction,direction)).toEqual({ range: true, values: [['',null],[null,'']] });
});
it('retains zeros, booleans and errors at the boundaries', () => {
  const values=[[0,false],[{error:'#N/A'},'']];
  expect(trim(values)).toEqual({ range:true,values });
});
it('preserves formula empty strings for downstream ROWS, COLUMNS, COUNTA and ISTEXT', () => {
  const cells={B2:'=""',C3:'1',D4:'=""'};
  expect(calc('ROWS(TRIMRANGE(A1:E5))',cells)).toBe(3);
  expect(calc('COLUMNS(TRIMRANGE(A1:E5))',cells)).toBe(3);
  expect(calc('COUNTA(TRIMRANGE(A1:E5))',cells)).toBe(3);
  expect(calc('SUMPRODUCT(--ISTEXT(TRIMRANGE(A1:E5)))',cells)).toBe(2);
  expect(calc('ROWS(TRIMRANGE({"";""}))')).toBe(2);
});
