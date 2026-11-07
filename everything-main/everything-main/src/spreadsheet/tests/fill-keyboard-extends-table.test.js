import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Dragging the fill handle or pasting under a table pulled the new rows into it, but Ctrl+D,
// Ctrl+R, Ctrl+Enter and the double-click fill left them outside: no banding, not in T[Amt], no
// calculated column. The fill itself now extends the table, whichever way it was asked for, and
// the drag path's own extendTableToCover call afterwards finds the table already grown.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book(opts = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt', 'Dbl'], ['a', 5], ['b', 7]]));
  const tid = wb.addTable(id, parseRange('A1:C3'), { name: 'T', ...opts });
  wb.setInput(id, 1, 2, '=[@Amt]*2');
  expect(wb.getValue(id, 2, 2)).toBe(14);
  wb.clearHistory();
  return { wb, id, tid, range: () => wb.tableById(id, tid).range };
}

it('pulls the row Ctrl+D fills under a table into it, with its calculated column, in one undo step', () => {
  const { wb, id, range } = book();
  wb.fillDirection(id, parseRange('A3:B4'), 'down');
  expect(range()).toEqual(parseRange('A1:C4'));
  expect([wb.getValue(id, 3, 0), wb.getValue(id, 3, 1), wb.getValue(id, 3, 2)]).toEqual(['b', 7, 14]);
  expect(wb.getCell(id, 3, 2).f).toBe('[@Amt]*2');
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(range()).toEqual(parseRange('A1:C3'));
  expect(wb.getCell(id, 3, 0)).toBeUndefined();
  // A lone cell filled from the one above it, right under the table, joins too.
  wb.fillDirection(id, parseRange('B4:B4'), 'down');
  expect(range()).toEqual(parseRange('A1:C4'));
  expect(wb.getValue(id, 3, 2)).toBe(14);
});

it('pulls in the rows Ctrl+Enter and the double-click fill write under a table', () => {
  const entered = book();
  entered.wb.fillInput(entered.id, parseRange('A4:B5'), '9', { r: 3, c: 0 });
  expect(entered.range()).toEqual(parseRange('A1:C5'));
  expect([entered.wb.getValue(entered.id, 4, 1), entered.wb.getValue(entered.id, 4, 2)]).toEqual([9, 18]);
  expect(entered.wb.undoLabels()).toHaveLength(1);
  const clicked = book();
  // The double-click fill is fill() over the target autoFillTarget chose; the drag path's own call is then a no-op.
  clicked.wb.transaction('Fill', () => {
    clicked.wb.fill(clicked.id, parseRange('A3:B3'), parseRange('A3:B5'));
    expect(clicked.wb.extendTableToCover(clicked.id, parseRange('A4:B5'))).toBe(false);
  });
  expect(clicked.range()).toEqual(parseRange('A1:C5'));
  expect(clicked.wb.getValue(clicked.id, 4, 2)).toBe(14);
  expect(clicked.wb.undoLabels()).toHaveLength(1);
  clicked.wb.undo();
  expect(clicked.range()).toEqual(parseRange('A1:C3'));
});

it('leaves a table with a totals row, a fill to the right, and a refused fill alone', () => {
  const totals = book({ totalsRow: true });
  totals.wb.fillDirection(totals.id, parseRange('A4:B5'), 'down');
  expect(totals.range()).toEqual(parseRange('A1:C4'));
  const right = book();
  right.wb.fillDirection(right.id, parseRange('C3:D3'), 'right');
  expect(right.range()).toEqual(parseRange('A1:C3'));
  const locked = book();
  locked.wb.protectRange(locked.id, parseRange('A4:A4'), 'Keep');
  const refused = [];
  locked.wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') refused.push(e.detail); });
  locked.wb.fillDirection(locked.id, parseRange('A3:B4'), 'down');
  expect(locked.range()).toEqual(parseRange('A1:C3'));
  expect(locked.wb.getCell(locked.id, 3, 1)).toBeUndefined();
  expect(refused).toHaveLength(1);
});
