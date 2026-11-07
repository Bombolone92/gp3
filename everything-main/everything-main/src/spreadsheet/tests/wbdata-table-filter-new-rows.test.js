import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

/** Table T over A1:B3 whose filter keeps only the Amt 5 row, hiding row 3. */
function filtered() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt'], ['x', 5], ['y', 7]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
  wb.setFilterCriteria(id, 1, { values: ['5'] });
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  return { wb, id, tid };
}

it('keeps a row typed under a filtered table in view as it joins the table', () => {
  const { wb, id, tid } = filtered();
  wb.setInput(id, 3, 0, 'z');
  expect(wb.tableById(id, tid).range.r2).toBe(3);
  expect(wb.sheet(id).filter.range.r2).toBe(3);
  expect(wb.isRowHidden(id, 3)).toBe(false);
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  wb.undo();
  expect(wb.tableById(id, tid).range.r2).toBe(2);
  wb.redo();
  expect(wb.tableById(id, tid).range.r2).toBe(3);
  expect(wb.isRowHidden(id, 3)).toBe(false);
  // Applying the filter again judges the row by its criteria, as for a row inserted into a filtered list.
  wb.reapplyFilter(id);
  expect(wb.isRowHidden(id, 3)).toBe(true);
});

it('keeps a row added below a filtered table in view', () => {
  const { wb, id, tid } = filtered();
  expect(wb.addTableRow(id, tid)).toBe(3);
  expect(wb.isRowHidden(id, 3)).toBe(false);
});

it('keeps rows pasted under a filtered table in view when the table takes them in', () => {
  const { wb, id, tid } = filtered();
  wb.pasteCells(id, [[{ v: 'p' }, { v: 1 }], [{ v: 'q' }, { v: 2 }]], 3, 0);
  expect(wb.extendTableToCover(id, { r1: 3, c1: 0, r2: 4, c2: 1 })).toBe(true);
  expect(wb.tableById(id, tid).range.r2).toBe(4);
  expect([wb.isRowHidden(id, 3), wb.isRowHidden(id, 4)]).toEqual([false, false]);
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
});
