import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function arr(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// SORTBY follows the shape of by_array: a column of keys orders rows, a row of keys orders columns.
describe('SORTBY by columns', () => {
  it('orders the columns of a one-row array by a row of keys', () => {
    expect(arr('SORTBY({1,2,3},{3,1,2})')).toEqual([[2, 3, 1]]);
    expect(arr('SORTBY({1,2,3},{3,1,2},-1)')).toEqual([[1, 3, 2]]);
  });

  it('orders the columns of a taller array by a row of keys as wide as the array', () => {
    expect(arr('SORTBY({1,2,3;4,5,6},{3,1,2})')).toEqual([[2, 3, 1], [5, 6, 4]]);
    expect(arr('SORTBY({1,2,3;4,5,6},{3,1,2},-1)')).toEqual([[1, 3, 2], [4, 6, 5]]);
    expect(arr('SORTBY({1,2;3,4},{2,1})')).toEqual([[2, 1], [4, 3]]);
  });

  it('breaks ties between columns with a second row of keys', () => {
    expect(arr('SORTBY({1,2,3},{1,1,2},1,{3,2,1},1)')).toEqual([[2, 1, 3]]);
  });

  it('still orders rows by a column of keys, and reads a row of keys as long as the array is tall as one', () => {
    expect(arr('SORTBY({3;1;2},{3;1;2})')).toEqual([[1], [2], [3]]);
    expect(arr('SORTBY({1;2;3},{3,1,2})')).toEqual([[2], [3], [1]]);
    expect(arr('SORTBY(A1:B3,B1:B3,-1)', { A1: 'x', B1: '1', A2: 'y', B2: '3', A3: 'z', B3: '2' })).toEqual([['y', 3], ['z', 2], ['x', 1]]);
  });

  it('rejects keys of another shape or mixed orientations', () => {
    expect(arr('SORTBY({1,2,3},{3,1})')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('SORTBY({1,2;3,4},{2,1},1,{1;2},1)')).toEqual([[{ error: '#VALUE!' }]]);
  });
});
