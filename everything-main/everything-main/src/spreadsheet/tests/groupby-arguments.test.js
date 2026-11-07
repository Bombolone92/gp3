import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

const SALES = {
  A1: 'Region', B1: 'Product', C1: 'Amount',
  A2: 'East', B2: 'Pen', C2: '10',
  A3: 'West', B3: 'Ink', C3: '5',
  A4: 'East', B4: 'Ink', C4: '20',
  A5: 'West', B5: 'Pen', C5: '7',
  A6: 'east', B6: 'Pen', C6: '3',
};

function arr(formula, cells = SALES) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

describe('GROUPBY and PIVOTBY arguments', () => {
  // field_headers was checked as a whole number but applied as given, so 1.5 passed the check and
  // then matched neither 1 nor 3: the header row was grouped as data.
  it('read a fractional field_headers as its whole part', () => {
    const headed = [['East', 33], ['West', 12], ['Total', 45]];
    expect(arr('GROUPBY(A1:A6,C1:C6,SUM,1)')).toEqual(headed);
    expect(arr('GROUPBY(A1:A6,C1:C6,SUM,1.5)')).toEqual(headed);
    expect(arr('GROUPBY(A1:A6,C1:C6,SUM,3.9)')).toEqual([['Region', 'Amount'], ...headed]);
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,2.5)')).toEqual([['Column1', 'Column2'], ...headed]);
    expect(arr('GROUPBY(A1:A6,C1:C6,SUM,4)')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('PIVOTBY(A1:A6,B1:B6,C1:C6,SUM,1.5)')).toEqual([
      ['', 'Ink', 'Pen', 'Total'],
      ['East', 20, 13, 33],
      ['West', 5, 7, 12],
      ['Total', 25, 20, 45],
    ]);
  });

  // A total depth names no totals (0), grand totals (1) or grand totals and subtotals (2), at the end
  // or, negative, at the top. PIVOTBY read any other number as "some totals" where GROUPBY refuses it.
  it('refuse a total depth outside the five it names, in PIVOTBY as in GROUPBY', () => {
    const pivot = [['', 'Ink', 'Pen', 'Total'], ['East', 20, 13, 33], ['West', 5, 7, 12], ['Total', 25, 20, 45]];
    const VALUE = [[{ error: '#VALUE!' }]];
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,0,7)')).toEqual(VALUE);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,7)')).toEqual(VALUE);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,-7)')).toEqual(VALUE);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1,,7)')).toEqual(VALUE); // the columns' depth
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,3)')).toEqual(VALUE);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1.7)')).toEqual(pivot); // read as 1, as GROUPBY reads its own
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,2)')).toEqual(pivot);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,0,,0)')).toEqual([['', 'Ink', 'Pen'], ['East', 20, 13], ['West', 5, 7]]);
  });

  // A sort_order past the output's columns was ignored, or sorted by a column it did not name.
  it('refuse a sort_order past the columns, or rows, of the output', () => {
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,0,0,2)')).toEqual([['West', 12], ['East', 33]]);
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,0,0,3)')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,0,0,-3)')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('GROUPBY(A2:A6,C2:C6,SUM,0,0,5)')).toEqual([[{ error: '#VALUE!' }]]);
    // A PIVOTBY's rows sort by one of its columns, here key, Ink, Pen and Total, and its columns by
    // one of its rows: key, East, West and Total. A total left out is not there to sort by.
    const pivot = [['', 'Ink', 'Pen', 'Total'], ['East', 20, 13, 33], ['West', 5, 7, 12], ['Total', 25, 20, 45]];
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1,-4)')).toEqual(pivot); // by the totals 33 and 12, descending
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1,5)')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1,4,0)')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1,,1,-4)')).toEqual(pivot); // by the totals 25 and 20, descending
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,1,,1,5)')).toEqual([[{ error: '#VALUE!' }]]);
    expect(arr('PIVOTBY(A2:A6,B2:B6,C2:C6,SUM,0,0,,1,4)')).toEqual([[{ error: '#VALUE!' }]]);
  });
});
