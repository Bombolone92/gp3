import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPivot, pivotFieldValues, previewPivot, PIVOT_ALL } from '../src/core/pivot.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['K', 'V'], ['a', 10], ['b', 20]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T', totalsRow: true });
  expect(wb.getValue(id, 3, 1)).toBe(30);
  return { wb, id, range: wb.tableById(id, tid).range };
}

// A pivot over a table's whole range (what its name stands for in the dialog) read the totals row as
// data, so its Total label became a category of its own, summing nothing.
it('leaves the totals row out of a pivot over a whole table', () => {
  const { wb, id, range } = book();
  expect(range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 1 });
  const built = buildPivot(wb, id, { range, rowField: 0, colField: null, valueField: 1, agg: 'sum' });
  const labels = built.cells.filter((x) => x.c === 0).map((x) => x.cell.v);
  expect(labels).toEqual(['K', 'a', 'b', 'Total']);
  expect(built.cells.find((x) => x.r === 1 && x.c === 1).cell.f).toBe('SUMIFS(T[V],T[K],$A2)');
  expect(previewPivot(wb, id, { range, rowField: 0, colField: null, valueField: 1, agg: 'sum' }).rowCount).toBe(2);
  expect(pivotFieldValues(wb, id, range, 0)).toEqual(['a', 'b']);
  // A filter field lists the values of the data rows alone: the total of 30 is none of them.
  const filtered = buildPivot(wb, id, { range, rowField: 0, colField: null, valueField: 1, agg: 'sum', filters: [{ field: 1, value: null }] });
  expect(filtered.filterCells).toEqual([{ r: 0, c: 1, values: [PIVOT_ALL, 10, 20] }]);
});

it('still reads a plain range, or a table without a totals row, to its last row', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['K', 'V'], ['a', 10], ['Total', 20]]));
  const plain = buildPivot(wb, id, { range: { r1: 0, c1: 0, r2: 2, c2: 1 }, rowField: 0, colField: null, valueField: 1, agg: 'sum' });
  expect(plain.cells.filter((x) => x.c === 0).map((x) => x.cell.v)).toEqual(['K', 'a', 'Total', 'Total']);
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
  expect(pivotFieldValues(wb, id, { r1: 0, c1: 0, r2: 2, c2: 1 }, 0)).toEqual(['a', 'Total']);
});
