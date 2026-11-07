import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('inserts space for totals instead of overwriting the next row and keeps references and undo intact', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount', 'Double'], ['A', 10, null], ['Keep below', 99, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 2, 2, '=B3*2');
  wb.setNote(id, 2, 0, 'Keep this note');
  wb.setRowHeight(id, 2, 45);
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 2 }, { name: 'Sales' });
  wb.setInput(id, 1, 2, '=[@Amount]*2');
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=Sheet1!B3');
  wb.clearHistory();
  const before = wb.toJSON();
  wb.setTableTotals(id, tid, true);
  expect(wb.getValue(id, 2, 0)).toBe('Total');
  expect(wb.getValue(id, 2, 1)).toBe(10);
  expect(wb.getValue(id, 2, 2)).toBe(20);
  expect(wb.getValue(id, 3, 0)).toBe('Keep below');
  expect(wb.getValue(id, 3, 1)).toBe(99);
  expect(wb.getValue(id, 3, 2)).toBe(198);
  expect(wb.getNote(id, 3, 0)).toBe('Keep this note');
  expect(wb.sheet(id).rowHeights.get(3)).toBe(45);
  expect(wb.getCell(other, 0, 0).f).toBe('Sheet1!B4');
  expect(wb.getValue(other, 0, 0)).toBe(99);
  expect(wb.tableById(id, tid).range.r2).toBe(2);
  expect(wb.undoLabels()).toEqual(['Add totals row']);
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
});

it.each(['note', 'format', 'table'])('keeps %s-only content below a table when adding totals', (kind) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount'], ['A', 10]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  let otherTable;
  if (kind === 'note') wb.setNote(id, 2, 0, 'Reserved');
  else if (kind === 'format') wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bg: '#ff0000' });
  else otherTable = wb.addTable(id, { r1: 2, c1: 0, r2: 3, c2: 1 });
  wb.setTableTotals(id, tid, true);
  expect(wb.getValue(id, 2, 1)).toBe(10);
  if (kind === 'note') expect(wb.getNote(id, 3, 0)).toBe('Reserved');
  else if (kind === 'format') expect(wb.getCell(id, 3, 0).s.bg).toBe('#ff0000');
  else expect(wb.tableById(id, otherTable).range).toEqual({ r1: 3, c1: 0, r2: 4, c2: 1 });
});

it('uses an empty row without moving content outside the table columns', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount'], ['A', 10]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 2, 4, 'Separate data');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  const rows = wb.sheet(id).rows;
  wb.setTableTotals(id, tid, true);
  expect(wb.getValue(id, 2, 1)).toBe(10);
  expect(wb.getValue(id, 2, 4)).toBe('Separate data');
  expect(wb.sheet(id).rows).toBe(rows);
});
