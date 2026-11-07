import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

// A bare table name in a dialog's range field stood for the table's whole range, totals row included, so
// a chart, a pivot or a rule over "Sales" took the Total row for data.
it('gives a bare table name its header and data rows, leaving the totals row out', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['K', 'V'], ['a', 10], ['b', 20], [null, null], ['K', 'V'], ['c', 30]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T', totalsRow: true });
  wb.addTable(id, { r1: 4, c1: 0, r2: 5, c2: 1 }, { name: 'U' });
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 1 });
  expect(wb.rangeFromText(id, 'T')).toEqual({ sheetId: id, range: { r1: 0, c1: 0, r2: 2, c2: 1 } });
  expect(wb.rangeFromText(id, 't')).toEqual({ sheetId: id, range: { r1: 0, c1: 0, r2: 2, c2: 1 } });
  // A table without a totals row is given whole, and the structured forms keep their own meaning.
  expect(wb.rangeFromText(id, 'U')).toEqual({ sheetId: id, range: { r1: 4, c1: 0, r2: 5, c2: 1 } });
  expect(wb.rangeFromText(id, 'T[#All]').range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 1 });
  expect(wb.rangeFromText(id, 'T[#Totals]').range).toEqual({ r1: 3, c1: 0, r2: 3, c2: 1 });
  expect(wb.rangeFromText(id, 'T[V]').range).toEqual({ r1: 1, c1: 1, r2: 2, c2: 1 });
  // Turning the totals row off gives the same rows.
  wb.setTableTotals(id, tid, false);
  expect(wb.rangeFromText(id, 'T').range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
});
