import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

it('keeps a calculated column on its column when a table is resized from its left edge', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['A', 'Qty', 'Amt'], [1, 2, null], [1, 3, null]]));
  const tid = wb.addTable(id, parseRange('A1:C3'), { name: 'T' });
  wb.setInput(id, 1, 2, '=[@Qty]*10');
  expect(wb.tableById(id, tid).calc).toEqual({ 2: '[@Qty]*10' });
  expect(wb.resizeTable(id, tid, parseRange('B1:C3'))).toBe(true);
  expect(wb.tableById(id, tid).calc).toEqual({ 1: '[@Qty]*10' });
  const r = wb.addTableRow(id, tid);
  wb.setInput(id, r, 1, '4');
  expect(wb.getCell(id, r, 2).f).toBe('[@Qty]*10');
  expect(wb.getValue(id, r, 2)).toBe(40);
  // Growing back to the left moves the key the other way; a column cut off takes its template with it.
  expect(wb.resizeTable(id, tid, parseRange('A1:C4'))).toBe(true);
  expect(wb.tableById(id, tid).calc).toEqual({ 2: '[@Qty]*10' });
  expect(wb.resizeTable(id, tid, parseRange('A1:B4'))).toBe(true);
  expect(wb.tableById(id, tid).calc).toEqual({});
  wb.undo();
  expect(wb.tableById(id, tid).calc).toEqual({ 2: '[@Qty]*10' });
});
