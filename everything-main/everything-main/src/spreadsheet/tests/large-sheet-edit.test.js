import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each([
  ['cell edit', (wb, id) => wb.setInput(id, 0, 0, 'Edit')],
  ['note', (wb, id) => wb.setNote(id, 0, 0, 'Note')],
  ['resize request', (wb, id) => wb.ensureSize(id, 110, 30)],
])('keeps imported rows and columns visible after a %s', (_label, edit) => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 30001, cols: 800, cells: { '30000,799': { v: 'Keep visible' } } }] });
  const id = wb.activeSheetId;
  edit(wb, id);
  expect(wb.activeSheet.rows).toBe(30001);
  expect(wb.activeSheet.cols).toBe(800);
  expect(wb.getValue(id, 30000, 799)).toBe('Keep visible');
  if (wb.canUndo()) {
    wb.undo();
    expect(wb.activeSheet.rows).toBe(30001);
    expect(wb.activeSheet.cols).toBe(800);
    wb.redo();
    expect(wb.activeSheet.rows).toBe(30001);
    expect(wb.activeSheet.cols).toBe(800);
  }
});

it.each(['row', 'column'])('keeps imported dimensions and moved edge cells visible after inserting a %s', (axis) => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 30001, cols: 800, cells: { '30000,799': { v: 'Keep visible' } } }] });
  const id = wb.activeSheetId;
  wb.setNote(id, 30000, 799, 'Edge note');
  wb.clearHistory();
  const before = wb.toJSON();
  if (axis === 'row') wb.insertRows(id, 0, 2);
  else wb.insertCols(id, 0, 2);
  const r = axis === 'row' ? 30002 : 30000;
  const c = axis === 'column' ? 801 : 799;
  expect(wb.activeSheet.rows).toBe(r + 1);
  expect(wb.activeSheet.cols).toBe(c + 1);
  expect(wb.getValue(id, r, c)).toBe('Keep visible');
  expect(wb.getNote(id, r, c)).toBe('Edge note');
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
});
