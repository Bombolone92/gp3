// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openTableResizeDialog, tableResizeProblem } from '../src/ui/tableresize.js';
import { openInsertSlicersDialog } from '../src/ui/insertslicers.js';
import { openInsertTimelineDialog } from '../src/ui/inserttimeline.js';
import { pivotBook } from './helpers/native-pivot-report-fixture.js';

vi.stubGlobal('matchMedia', () => ({ matches: true }));
afterEach(() => document.body.replaceChildren());
function book() {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['Region', 'Rep', 'Amount'], ['East', 'Ann', '4'], ['West', 'Bob', '9']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  const tableId = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'Sales' });
  const ctx = { wb, sheetId: () => id, grid: { focus: vi.fn(), setSelection: vi.fn(), selectChart: vi.fn(), range: { r1: 0, c1: 0, r2: 4, c2: 3 } } };
  return { wb, id, tableId, ctx };
}
const dialog = () => document.querySelector('.modal-root:not(.closing) .modal-panel');

it('checks a resize: the header stays in its row and the ranges overlap', () => {
  const table = { range: { r1: 2, c1: 1, r2: 8, c2: 3 } };
  expect(tableResizeProblem(table, null)).toMatch(/Enter a range/);
  expect(tableResizeProblem(table, { r1: 3, c1: 1, r2: 8, c2: 3 })).toMatch(/same row/);
  expect(tableResizeProblem(table, { r1: 2, c1: 5, r2: 8, c2: 6 })).toMatch(/overlap/);
  expect(tableResizeProblem(table, { r1: 2, c1: 1, r2: 12, c2: 4 })).toBeNull();
});

it('resizes a table from the Resize Table dialog, taking the selection on request', () => {
  const { wb, id, tableId, ctx } = book();
  openTableResizeDialog(ctx, wb.tableById(id, tableId));
  const input = dialog().querySelector('input');
  expect(input.value).toBe('$A$1:$C$3');
  [...dialog().querySelectorAll('button')].find(b => b.textContent === 'Use selection').click();
  expect(input.value).toBe('$A$1:$D$5');
  dialog().querySelector('form').requestSubmit();
  expect(wb.tableById(id, tableId).range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 3 });
  expect(wb.tableColumns(id, wb.tableById(id, tableId))).toEqual(['Region', 'Rep', 'Amount', 'Column4']);
});

it('refuses a resize that moves the header row and says why', () => {
  const { wb, id, tableId, ctx } = book();
  openTableResizeDialog(ctx, wb.tableById(id, tableId));
  dialog().querySelector('input').value = 'A2:C5';
  dialog().querySelector('form').requestSubmit();
  expect(dialog().textContent).toMatch(/headers must remain in the same row/);
  expect(wb.tableById(id, tableId).range.r2).toBe(2);
});

it('lists a checkbox per table column and inserts a slicer for each one ticked', () => {
  const { wb, id, tableId, ctx } = book();
  openInsertSlicersDialog(ctx, { table: wb.tableById(id, tableId) });
  expect(dialog().querySelector('.modal-title').textContent).toBe('Insert Slicers');
  const boxes = [...dialog().querySelectorAll('input[type=checkbox]')];
  expect(boxes.map(b => b.closest('label').textContent)).toEqual(['Region', 'Rep', 'Amount']);
  boxes[0].click(); boxes[2].click();
  dialog().querySelector('form').requestSubmit();
  expect(wb.sheet(id).charts.map(c => c.title)).toEqual(['Region', 'Amount']);
  expect(ctx.grid.selectChart).toHaveBeenCalled();
});

it('lists a PivotTable’s fields, and its date fields for a timeline', () => {
  const { wb, report, pivot } = pivotBook({ dateField: true });
  const ctx = { wb, sheetId: () => report.id, grid: { focus: vi.fn(), selectChart: vi.fn() } };
  openInsertSlicersDialog(ctx, { pivot });
  expect([...dialog().querySelectorAll('label')].map(l => l.textContent)).toEqual(['Region', 'Amount', 'When']);
  dialog().querySelector('.btn-ghost').click();
  openInsertTimelineDialog(ctx, pivot);
  const boxes = [...dialog().querySelectorAll('input[type=checkbox]')];
  expect(boxes.map(b => b.closest('label').textContent)).toEqual(['When']);
  expect(boxes[0].checked).toBe(true);
  dialog().querySelector('form').requestSubmit();
  expect(wb.sheet(report.id).charts.map(c => [c.type, c.field])).toEqual([['timeline', 'When']]);
});
