import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/** Spill a formula at F1 over cells given as rows from A1 and read the block back. */
function spill(rows, formula) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v, f: null } }))));
  wb.setInput(id, 0, 5, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 5) || { r1: 0, c1: 5, r2: 0, c2: 5 };
  return wb.rangeValues(id, range);
}

// PIVOTBY built a Set of the column group's rows and filtered the row group against it for every
// cell, and again for every comparison when sorting by a column, so a pivot of a thousand rows by
// twenty columns over 20000 source rows took seconds. The rows are now bucketed by column once.
describe('PIVOTBY', () => {
  const sales = [
    ['West', 'Ink', 2],
    ['East', 'Pen', 1],
    ['East', 'Ink', 4],
    ['North', 'Pen', 8],
    ['West', 'Pen', 16],
  ];

  it('leaves an intersection with no rows blank and totals the rest', () => {
    expect(spill(sales, 'PIVOTBY(A1:A5,B1:B5,C1:C5,SUM)')).toEqual([
      ['', 'Ink', 'Pen', 'Total'],
      ['East', 4, 1, 5],
      ['North', '', 8, 8],
      ['West', 2, 16, 18],
      ['Total', 6, 25, 31],
    ]);
  });

  it('sorts rows by a column of the pivot and columns by its total row', () => {
    // -3: the Pen column, descending (16, 8, 1); -5: the total row of three groups, descending (25, 6).
    expect(spill(sales, 'PIVOTBY(A1:A5,B1:B5,C1:C5,SUM,0,1,-3,1,-5)')).toEqual([
      ['', 'Pen', 'Ink', 'Total'],
      ['West', 16, 2, 18],
      ['North', 8, '', 8],
      ['East', 1, 4, 5],
      ['Total', 25, 6, 31],
    ]);
  });

  it('pivots 20000 rows into 2000 rows by 10 columns, sorted by their totals, in well under a second', () => {
    // Row i is key K(i mod 2000) under column C(floor(i / 2000)) with the value i: Kk holds k + 2000t
    // under Ct for t = 0..9, 10k + 90000 in all, and column Ct totals 1999000 + 4000000t.
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, Array.from({ length: 20000 }, (_, i) => [`K${i % 2000}`, `C${Math.floor(i / 2000)}`, i]).flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v, f: null } }))));
    const start = performance.now();
    // Sort order -12 names the twelfth output column, the total after the key and ten columns, descending.
    wb.setInput(id, 0, 5, '=PIVOTBY(A1:A20000,B1:B20000,C1:C20000,SUM,0,1,-12)');
    const out = wb.rangeValues(id, wb.spillRangeAt(id, 0, 5));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(out).toHaveLength(2002);
    expect(out[0]).toEqual(['', ...Array.from({ length: 10 }, (_, t) => `C${t}`), 'Total']);
    expect(out[1]).toEqual(['K1999', ...Array.from({ length: 10 }, (_, t) => 1999 + 2000 * t), 109990]);
    expect(out[2][0]).toBe('K1998');
    expect(out[2000]).toEqual(['K0', ...Array.from({ length: 10 }, (_, t) => 2000 * t), 90000]);
    expect(out[2001]).toEqual(['Total', ...Array.from({ length: 10 }, (_, t) => 1999000 + 4000000 * t), 199990000]);
  });
});
