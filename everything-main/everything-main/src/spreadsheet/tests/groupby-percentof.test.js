import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

const SALES = {
  A1: 'Region', B1: 'Product', C1: 'Amount',
  A2: 'East', B2: 'Pen', C2: '10',
  A3: 'West', B3: 'Ink', C3: '5',
  A4: 'East', B4: 'Ink', C4: '20',
  A5: 'West', B5: 'Pen', C5: '7',
  A6: 'East', B6: 'Pen', C6: '3',
}; // East 33, West 12, of 45

function arr(formula, cells = SALES) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// GROUPBY and PIVOTBY called PERCENTOF with a group's values alone, so it had nothing to divide by and
// every cell was #DIV/0!. PERCENTOF by name now gives each group's share of all the values.
describe('GROUPBY and PIVOTBY with PERCENTOF', () => {
  it('give each group its share of the whole, and the total its 1', () => {
    expect(arr('GROUPBY(A2:A6,C2:C6,PERCENTOF)')).toEqual([['East', 33 / 45], ['West', 12 / 45], ['Total', 1]]);
    expect(arr('GROUPBY({"a";"b";"a"},{1;2;3},PERCENTOF)')).toEqual([['a', 4 / 6], ['b', 2 / 6], ['Total', 1]]);
    expect(arr('GROUPBY(A1:A6,C1:C6,PERCENTOF,3,0)')).toEqual([['Region', 'Amount'], ['East', 33 / 45], ['West', 12 / 45]]);
  });

  it('take the share of the rows the filter keeps', () => {
    expect(arr('GROUPBY(A2:A6,C2:C6,PERCENTOF,0,1,0,C2:C6<>7)')).toEqual([['East', 33 / 38], ['West', 5 / 38], ['Total', 1]]);
  });

  it('sort by the share column', () => {
    expect(arr('GROUPBY(A2:A6,C2:C6,PERCENTOF,0,0,-2)')).toEqual([['East', 33 / 45], ['West', 12 / 45]]);
    expect(arr('GROUPBY(A2:A6,C2:C6,PERCENTOF,0,0,2)')).toEqual([['West', 12 / 45], ['East', 33 / 45]]);
  });

  it('give each pivot cell its share of the grand total', () => {
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,PERCENTOF)')).toEqual([
      ['', 'Ink', 'Pen', 'Total'],
      ['East', 20 / 45, 13 / 45, 33 / 45],
      ['West', 5 / 45, 7 / 45, 12 / 45],
      ['Total', 25 / 45, 20 / 45, 1],
    ]);
  });

  it('leave the LAMBDA form and the other functions as they were', () => {
    expect(arr('GROUPBY(A2:A6,C2:C6,LAMBDA(x,PERCENTOF(x,C2:C6)),0,0)')).toEqual([['East', 33 / 45], ['West', 12 / 45]]);
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,0,0)')).toEqual([['East', 33], ['West', 12]]);
    expect(arr('PERCENTOF(C2:C3,C2:C6)')).toEqual([[15 / 45]]);
  });
});
