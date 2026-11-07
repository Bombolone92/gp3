import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function arr(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 9, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 9, 9) || { r1: 9, c1: 9, r2: 9, c2: 9 };
  return wb.rangeValues(id, range);
}

const VALUE = [[{ error: '#VALUE!' }]];

// Excel's fourth SORT argument, by_col, is a logical that Excel users write 1 or 0 as often as TRUE or
// FALSE. It was honoured only as a boolean; a number was read as Sheets' next sort column, which sorted
// the rows a second time by the same column and left SORT({3,1,2},1,1,1) as it was. Sheets' sort columns
// come in pairs with their orders, so a call of exactly four arguments is Excel's form whatever the type.
it.each([
  ['SORT({3,1,2},1,1,1)', [[1, 2, 3]]],
  ['SORT({3,1,2},1,-1,1)', [[3, 2, 1]]],
  ['SORT({3,1,2},1,1,2)', [[1, 2, 3]]], // any other number is TRUE, as for a logical
  ['SORT({3,1,2},1,1,0)', [[3, 1, 2]]], // by row: one row has nothing to reorder
  ['SORT({3,1,2;9,8,7},2,1,1)', [[2, 1, 3], [7, 8, 9]]], // columns ordered by the second row
  ['SORT({3,1,2},1,1,TRUE)', [[1, 2, 3]]],
  ['SORT({3,1,2},1,1,"x")', VALUE],
  ['SORT({3,1,2},1,1,{1,0})', VALUE], // by_col is one value
])('%s', (formula, expected) => {
  expect(arr(formula)).toEqual(expected);
});

it('reads by_col from a cell', () => {
  const cells = { A1: '3', B1: '1', C1: '2', D1: '1', D2: '0' };
  expect(arr('SORT(A1:C1,1,1,D1)', cells)).toEqual([[1, 2, 3]]);
  expect(arr('SORT(A1:C1,1,1,D2)', cells)).toEqual([[3, 1, 2]]);
});

it('keeps Sheets\' pairs of sort columns and orders', () => {
  expect(arr('SORT({"b",2;"a",1;"b",1},1,1,2,-1)')).toEqual([['a', 1], ['b', 2], ['b', 1]]);
  expect(arr('SORT({"b",2;"a",1;"b",1},1,1,2,1)')).toEqual([['a', 1], ['b', 1], ['b', 2]]);
});
