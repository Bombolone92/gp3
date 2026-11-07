import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('updates calculated-column templates when their input cells move', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 6, '5');
  wb.setCells(id, [['Qty', 'Amount'], [2, null], [3, null]].flatMap((row, r) =>
    row.map((v, c) => ({ r, c, cell: { v } }))));
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  wb.setInput(id, 1, 1, '=[@Qty]*$G$1');
  const other = wb.addSheet('Summary').id;
  wb.setCells(other, [['Qty', 'Amount'], [4, null]].flatMap((row, r) =>
    row.map((v, c) => ({ r, c, cell: { v } }))));
  const summary = wb.addTable(other, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Orders' });
  wb.setInput(other, 1, 1, '=[@Qty]*Sheet1!$G$1');
  wb.clearHistory();
  const before = wb.toJSON();
  wb.moveRange(id, { r1: 0, c1: 6, r2: 0, c2: 6 }, 0, 7);
  expect(wb.getValue(id, 1, 1)).toBe(10);
  expect(wb.getValue(other, 1, 1)).toBe(20);
  expect(wb.tableById(id, table).calc[1]).toBe('[@Qty]*$H$1');
  expect(wb.tableById(other, summary).calc[1]).toBe('[@Qty]*Sheet1!$H$1');
  expect(wb.undoLabels()).toEqual(['Move cells']);
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
  for (const [sid, tid] of [[id, table], [other, summary]]) {
    const row = wb.addTableRow(sid, tid);
    wb.setInput(sid, row, 0, '6');
    expect(wb.getValue(sid, row, 1)).toBe(30);
  }
});
