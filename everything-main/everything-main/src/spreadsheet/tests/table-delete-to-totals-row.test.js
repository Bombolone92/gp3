import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Qty'], ['x', 1], ['y', 2]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T', totalsRow: true });
  expect(wb.getValue(id, 3, 1)).toBe(3);
  return { wb, id, tid };
}

// Deleting a table's header and data rows promoted its totals row to the header while the table still said
// it had a totals row: a one-row table whose header was its own footer. Add row then inserted a row above
// the table, and turning totals off cleared the header and left the table ending before it began.
it('drops the totals flag when the totals row is the only row left, so it is a header and nothing more', () => {
  const { wb, id, tid } = book();
  wb.clearHistory();
  const before = new Workbook(wb.toJSON()).toJSON();
  wb.deleteRows(id, 0, 3);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: false, range: { r1: 0, c1: 0, r2: 0, c2: 1 } });
  // The promoted row's texts are the column names, as when a data row is promoted.
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Total', '3']);
  const row = wb.addTableRow(id, tid);
  expect(row).toBe(1);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: false, range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
  wb.setInput(id, row, 1, '5');
  wb.setTableTotals(id, tid, true);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: true, range: { r1: 0, c1: 0, r2: 2, c2: 1 } });
  expect(wb.getValue(id, 2, 1)).toBe(5);
  wb.setTableTotals(id, tid, false);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: false, range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
  expect(wb.getValue(id, 0, 0)).toBe('Total');
  while (wb.undoLabels().length) wb.undo();
  expect(wb.toJSON()).toEqual(before);
});

it('turns the totals row off, and adds a row, on a table left with only its header and totals rows', () => {
  const { wb, id, tid } = book();
  wb.deleteRows(id, 1, 2);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: true, range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
  wb.setTableTotals(id, tid, false);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: false, range: { r1: 0, c1: 0, r2: 0, c2: 1 } });
  expect(wb.getCell(id, 1, 1)?.f ?? null).toBeNull();
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Name', 'Qty']);
  const row = wb.addTableRow(id, tid);
  expect(row).toBe(1);
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, row, 1, '4');
  wb.setInput(id, 5, 5, '=SUM(T[Qty])');
  expect(wb.getValue(id, 5, 5)).toBe(4);
});
