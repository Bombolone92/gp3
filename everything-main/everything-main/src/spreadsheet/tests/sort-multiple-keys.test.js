import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

const S = { A1: 'b', B1: '1', A2: 'a', B2: '2', A3: 'a', B3: '3' };

function arr(formula, cells = S) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

const VALUE = [[{ error: '#VALUE!' }]];

describe('SORT with several keys', () => {
  it('sorts by each index of an array constant with the matching order', () => {
    expect(arr('SORT(A1:B3,{1,2},{1,-1})')).toEqual([['a', 3], ['a', 2], ['b', 1]]);
    expect(arr('SORT(A1:B3,{1;2},{1;-1})')).toEqual([['a', 3], ['a', 2], ['b', 1]]);
    expect(arr('SORT(A1:B3,{1,2})')).toEqual([['a', 2], ['a', 3], ['b', 1]]);
    expect(arr('SORT(A1:B3,{2,1},-1)')).toEqual([['a', 3], ['a', 2], ['b', 1]]);
    expect(arr('SORT({3,1,2;9,8,7},{1,2},{1,1},TRUE)')).toEqual([[1, 2, 3], [8, 7, 9]]);
  });

  it('rejects orders that do not pair with the indexes', () => {
    expect(arr('SORT(A1:B3,{1,2},{1,-1,1})')).toEqual(VALUE);
    expect(arr('SORT(A1:B3,1,{1,-1})')).toEqual(VALUE);
    expect(arr('SORT(A1:B3,{1,2},{1,0})')).toEqual(VALUE);
    expect(arr('SORT(A1:B3,{1,3},{1,-1})')).toEqual(VALUE);
  });

  it('accepts only 1 and -1 as numeric orders, and TRUE or FALSE as Sheets does', () => {
    expect(arr('SORT(A1:B3,1,-1)')).toEqual([['b', 1], ['a', 2], ['a', 3]]);
    expect(arr('SORT(A1:B3,1,1)')).toEqual([['a', 2], ['a', 3], ['b', 1]]);
    expect(arr('SORT(A1:B3,1,0)')).toEqual(VALUE);
    expect(arr('SORT(A1:B3,1,2)')).toEqual(VALUE);
    expect(arr('SORT(A1:B3,2,FALSE)')).toEqual([['a', 3], ['a', 2], ['b', 1]]);
    expect(arr('SORT(A1:A3,B1:B3,FALSE)')).toEqual([['a'], ['a'], ['b']]);
  });
});

describe('SORTBY orders', () => {
  it('accepts only 1 and -1', () => {
    expect(arr('SORTBY({3;1;2},{3;1;2},-1)')).toEqual([[3], [2], [1]]);
    expect(arr('SORTBY({3;1;2},{3;1;2},1)')).toEqual([[1], [2], [3]]);
    expect(arr('SORTBY({3;1;2},{3;1;2},0)')).toEqual(VALUE);
    expect(arr('SORTBY({3;1;2},{3;1;2},2)')).toEqual(VALUE);
  });
});
