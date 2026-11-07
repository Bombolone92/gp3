import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

const F = { A1: 'a', B1: '1', A2: 'b', B2: '2', A3: 'c', B3: '3', D1: 'none' };

function arr(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(F)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// FILTER's if_empty may be an array, which spills when nothing passes the filter.
describe('FILTER with an array as if_empty', () => {
  it('spills the array when no row matches', () => {
    expect(arr('FILTER(A1:A3,B1:B3>100,{1,2})')).toEqual([[1, 2]]);
    expect(arr('FILTER(A1:A3,B1:B3>100,{"none"})')).toEqual([['none']]);
    expect(arr('FILTER(A1:B3,B1:B3>100,{1,2})')).toEqual([[1, 2]]);
    expect(arr('FILTER(A1:A3,B1:B3>100,D1)')).toEqual([['none']]);
    expect(arr('FILTER(A1:A3,B1:B3>100,"none")')).toEqual([['none']]);
  });

  it('ignores if_empty when rows match', () => {
    expect(arr('FILTER(A1:A3,B1:B3>1,{1,2})')).toEqual([['b'], ['c']]);
  });

  it('still reads a column as tall as the data as another condition', () => {
    expect(arr('FILTER(A1:A3,B1:B3>1,A1:A3="b")')).toEqual([['b']]);
    expect(arr('FILTER(A1:A3,B1:B3>100,A1:A3="b")')).toEqual([[{ error: '#CALC!' }]]);
    expect(arr('FILTER(A1:A3,B1:B3>100)')).toEqual([[{ error: '#CALC!' }]]);
  });
});
