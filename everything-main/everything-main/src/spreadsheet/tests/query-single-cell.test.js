import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

const SALES = { A1: 'Region', B1: 'Product', C1: 'Amount', A2: 'East', B2: 'Pen', C2: '10', A3: 'West', B3: 'Ink', C3: '5' };

function arr(formula, cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// A single cell reached QUERY as a bare value and was refused as no range; it is now a range of one
// cell that carries its address, so the query can name its column by letter.
describe('QUERY over one cell', () => {
  it('answers the cell, by its column letter or as Col1', () => {
    expect(calc('QUERY(C2,"select C")', SALES)).toBe(10);
    expect(calc('QUERY(C2,"select Col1")', SALES)).toBe(10);
    expect(calc('QUERY(C2,"select *")', SALES)).toBe(10);
    expect(calc('QUERY(C2,"select D")', SALES)).toEqual({ error: '#VALUE!' });
    expect(calc('QUERY(5,"select Col1")')).toBe(5);
    expect(calc('QUERY(C2:C2,"select C")', SALES)).toBe(10);
  });

  it('still answers every row of a bounded range, the blank ones included', () => {
    expect(arr('QUERY(A1:A6,"select A")', { A1: 'h', A2: '1', A3: '2' })).toEqual([['h'], [1], [2], [''], [''], ['']]);
    expect(arr('QUERY(A1:B2,"select B where A = 1")', { A1: 'a', B1: 'b', A2: '1', B2: 'x' })).toEqual([['b'], ['x']]);
  });
});
