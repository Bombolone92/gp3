import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Amount', 'Note'], [2, null, 'a'], [3, null, 'b']].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const first = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'First' });
  wb.setInput(id, 1, 1, '=[@Qty]*2');
  const second = wb.addTable(id, { r1: 3, c1: 2, r2: 5, c2: 3 }, { name: 'Second' });
  wb.clearHistory();
  return { wb, id, first, second };
}

it('refuses a resize that overlaps another table without changing cells, metadata, or history', () => {
  const { wb, id, first } = setup();
  const before = wb.toJSON();
  expect(wb.resizeTable(id, first, { r1: 0, c1: 0, r2: 3, c2: 2 })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('retains a typed value but does not expand or fill into an overlapping table', () => {
  const { wb, id, first, second } = setup();
  const other = wb.tableById(id, second);
  wb.setInput(id, 3, 0, '7');
  expect(wb.getValue(id, 3, 0)).toBe(7);
  expect(wb.getValue(id, 3, 1)).toBeNull();
  expect(wb.tableById(id, first).range.r2).toBe(2);
  expect(wb.tableById(id, second)).toEqual(other);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.getValue(id, 3, 0)).toBeNull();
});

it('reports refused pasted-block extension without filling calculated columns', () => {
  const { wb, id, first } = setup();
  const before = wb.toJSON();
  expect(wb.extendTableToCover(id, { r1: 3, c1: 0, r2: 4, c2: 0 })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.tableById(id, first).range.r2).toBe(2);
  expect(wb.canUndo()).toBe(false);
});

it('allows adjacent tables without treating a shared boundary as overlap', () => {
  const { wb, id, first } = setup();
  expect(wb.resizeTable(id, first, { r1: 0, c1: 0, r2: 5, c2: 1 })).toBe(true);
  expect(wb.tableById(id, first).range).toEqual({ r1: 0, c1: 0, r2: 5, c2: 1 });
});
