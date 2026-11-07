import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS } from '../src/core/workbook.js';

it('refuses a totals row or a new row that would land past the last row of the grid', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const last = MAX_ROWS - 1;
  wb.setInput(id, last - 1, 0, 'H');
  wb.setInput(id, last, 0, '5');
  const before = wb.toJSON();
  expect(wb.addTable(id, { r1: last - 1, c1: 0, r2: last, c2: 0 }, { totalsRow: true })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  const tid = wb.addTable(id, { r1: last - 1, c1: 0, r2: last, c2: 0 });
  expect(tid).toBeTruthy();
  wb.clearHistory();
  const snapshot = wb.toJSON();
  wb.setTableTotals(id, tid, true);
  expect(wb.updateTable(id, tid, { totalsRow: true })).toBe(false);
  expect(wb.addTableRow(id, tid)).toBe(-1);
  expect(wb.tableById(id, tid).range.r2).toBe(last);
  expect(wb.toJSON()).toEqual(snapshot);
  expect(wb.canUndo()).toBe(false);
});

it('still adds a totals row on the grid\'s last row, on a sheet not scrolled that far', () => {
  const wb = new Workbook({ sheets: [{ name: 'Short', rows: 100 }] });
  const id = wb.activeSheetId;
  const last = MAX_ROWS - 2;
  wb.setInput(id, last - 1, 0, 'H');
  wb.setInput(id, last, 0, '5');
  const tid = wb.addTable(id, { r1: last - 1, c1: 0, r2: last, c2: 0 });
  wb.setTableTotals(id, tid, true);
  expect(wb.tableById(id, tid).range.r2).toBe(last + 1);
  expect(wb.getValue(id, last + 1, 0)).toBe(5);
});
