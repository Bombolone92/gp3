import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

function arr(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, String(text)); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}
const E = (code) => ({ error: code });

// IFS over an array of conditions and SWITCH over an array of expressions spill one answer
// per cell, as IF, IFERROR and IFNA already do, instead of #VALUE!.
describe('IFS over arrays', () => {
  it('spills the value of each cell\'s first TRUE condition', () => {
    const D = { A1: 1, A2: 2, A3: 3 };
    expect(arr('IFS(A1:A3>2,"big",A1:A3>1,"mid",TRUE,"small")', D)).toEqual([['small'], ['mid'], ['big']]);
    expect(arr('IFS(A1:A2>1,"big",TRUE,"small")', { A1: 1, A2: 2 })).toEqual([['small'], ['big']]);
    expect(arr('ARRAYFORMULA(IFS(A1:A2>1,"big",TRUE,"small"))', { A1: 1, A2: 2 })).toEqual([['small'], ['big']]);
    expect(arr('IFS({1,2,3}>1,"y")')).toEqual([[E('#N/A'), 'y', 'y']]); // no condition holds: #N/A, as for one value
  });

  it('takes array values, later array conditions and scalar conditions ahead of the array', () => {
    const D = { A1: 1, A2: 2 };
    expect(arr('IFS(FALSE,"never",A1:A2>1,"big",TRUE,A1:A2*10)', D)).toEqual([[10], ['big']]);
    expect(arr('IFS(A1:A2>1,,TRUE,5)', D)).toEqual([[5], [0]]); // a value left empty is 0, as for IF
    expect(arr('IFS(A1:A2>1,"big",A1:A2=1,"one")', D)).toEqual([['one'], ['big']]);
    expect(calc('SUM(IFS(A1:A2>1,100,TRUE,1))', D)).toBe(101);
  });

  it('carries an error cell of a condition into its own cell only', () => {
    expect(arr('IFS(A1:A2>1,"big",TRUE,"small")', { A1: '=1/0', A2: 2 })).toEqual([[E('#DIV/0!')], ['big']]);
    expect(arr('IFS(A1:A2>1,"big",TRUE,"small")', { A1: 'x', A2: 2 })).toEqual([['big'], ['big']]); // text is above any number
  });

  it('still answers a scalar condition lazily and in order', () => {
    expect(calc('IFS(TRUE,1,1/0,2)')).toBe(1);
    expect(calc('IFS(FALSE,1,TRUE,2)')).toBe(2);
    expect(calc('IFS(FALSE,1)')).toEqual(E('#N/A'));
    expect(calc('IFS(1/0,1,TRUE,2)')).toEqual(E('#DIV/0!'));
    expect(calc('IFS("x",1,TRUE,2)')).toEqual(E('#VALUE!'));
    expect(calc('IFS(A1>0,,TRUE,5)', { A1: '3' })).toBe(0);
    expect(calc('MAP(A1:A2,LAMBDA(x,IFS(x>1,"big",TRUE,"small")))', { A1: 1, A2: 2 })).toBe('small');
  });
});

describe('SWITCH over arrays', () => {
  it('spills the result of each cell\'s first matching case, or the default', () => {
    expect(arr('SWITCH({1,2,3},1,"a",2,"b")')).toEqual([['a', 'b', E('#N/A')]]);
    expect(arr('SWITCH({1,2,3},1,"a",2,"b","other")')).toEqual([['a', 'b', 'other']]);
    expect(arr('SWITCH(A1:A2,"x",1,"y",2)', { A1: 'X', A2: 'y' })).toEqual([[1], [2]]); // text compares without case
    expect(arr('SWITCH(A1:A2,1,A1:A2*10,0)', { A1: 1, A2: 2 })).toEqual([[10], [0]]);
    expect(arr('SWITCH(A1:A3,0,"zero","other")', { A2: 5 })).toEqual([['zero'], ['other'], ['zero']]); // an empty cell equals 0
    expect(arr('SWITCH(A1:A2,"1","text",1,"number")', { A1: 1, A2: "'1" })).toEqual([['number'], ['text']]); // one type only
  });

  it('carries an error cell of the expression into its own cell only', () => {
    expect(arr('SWITCH(A1:A2,2,"two","other")', { A1: '=1/0', A2: 2 })).toEqual([[E('#DIV/0!')], ['two']]);
    expect(arr('SWITCH({1,2},1/0,"x","other")')).toEqual([[E('#DIV/0!'), E('#DIV/0!')]]);
  });

  it('still answers a scalar expression', () => {
    expect(calc('SWITCH(2,1,"a",2,"b")')).toBe('b');
    expect(calc('SWITCH(3,1,"a","z")')).toBe('z');
    expect(calc('SWITCH(3,1,"a")')).toEqual(E('#N/A'));
    expect(calc('SWITCH(A1,0,"zero","other")')).toBe('zero');
    expect(calc('SWITCH(1,1,,"other")')).toBe(0);
  });
});
