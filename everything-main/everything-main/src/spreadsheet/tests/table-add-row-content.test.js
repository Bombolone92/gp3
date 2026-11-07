import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['cell', 'note', 'table'])('makes a blank table row without consuming an existing %s below it', (kind) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Amount'], [2, null], [3, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  wb.setInput(id, 1, 1, '=[@Qty]*2');
  let other = null;
  if (kind === 'cell') wb.setCells(id, [{ r: 3, c: 1, cell: { v: 99, s: { fmt: 'currency' } } }]);
  if (kind === 'note') wb.setNote(id, 3, 1, 'Keep this note');
  if (kind === 'table') {
    wb.setCells(id, [['Qty', 'Amount'], [4, null], [5, null]].flatMap((row, r) => row.map((v, c) => ({ r: r + 3, c: c + 1, cell: { v } }))));
    other = wb.addTable(id, { r1: 3, c1: 1, r2: 5, c2: 2 }, { name: 'Other' });
    wb.setInput(id, 4, 2, '=[@Qty]*3');
  }
  const sid = wb.addSheet('Summary').id;
  wb.setInput(sid, 0, 0, '=Sheet1!B4');
  const originalValue = wb.getValue(sid, 0, 0);
  const originalCell = wb.getCell(id, 3, 1);
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.addTableRow(id, tid)).toBe(3);
  expect(wb.tableById(id, tid).range.r2).toBe(3);
  expect(wb.getValue(id, 3, 0)).toBeNull();
  expect(wb.getValue(id, 3, 1)).toBe(0);
  expect(wb.getCell(id, 4, 1)).toEqual(originalCell);
  expect(wb.getValue(sid, 0, 0)).toBe(originalValue);
  expect(wb.getCell(sid, 0, 0).f).toBe('Sheet1!B5');
  if (kind === 'note') {
    expect(wb.getNote(id, 3, 1)).toBeNull();
    expect(wb.getNote(id, 4, 1)).toBe('Keep this note');
  }
  if (other) {
    expect(wb.tableById(id, other).range).toEqual({ r1: 4, c1: 1, r2: 6, c2: 2 });
    expect(wb.getValue(id, 5, 2)).toBe(12);
    expect(wb.getValue(id, 6, 2)).toBe(15);
  }
  const after = wb.toJSON();
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
  wb.setInput(id, 3, 0, '7');
  expect(wb.getValue(id, 3, 1)).toBe(14);
  expect(wb.getValue(sid, 0, 0)).toBe(originalValue);
});
