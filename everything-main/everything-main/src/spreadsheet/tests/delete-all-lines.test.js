import { expect, it } from 'vitest';
import { Workbook, DEFAULT_ROWS, DEFAULT_COLS } from '../src/core/workbook.js';

it('empties the sheet when every row is deleted, keeping nothing from the last row', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'first');
  wb.setInput(id, 99, 0, 'last');
  wb.setNote(id, 99, 0, 'note');
  wb.setRowHeight(id, 99, 60);
  wb.deleteRows(id, 0, wb.sheet(id).rows);
  expect(wb.getValue(id, 0, 0)).toBe(null);
  expect(wb.sheet(id).cells.size).toBe(0);
  expect(wb.sheet(id).notes.size).toBe(0);
  expect(wb.rowHeight(id, 0)).toBe(wb.rowHeight(id, 5));
  expect(wb.sheet(id).rows).toBe(DEFAULT_ROWS);
  wb.undo();
  expect(wb.getValue(id, 99, 0)).toBe('last');
  expect(wb.getNote(id, 99, 0)).toBe('note');
});

it('empties the sheet when every column is deleted', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 25, 'last');
  wb.deleteCols(id, 0, wb.sheet(id).cols);
  expect(wb.getValue(id, 0, 0)).toBe(null);
  expect(wb.sheet(id).cols).toBe(DEFAULT_COLS);
});

it('still deletes a partial block from the end normally', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'keep');
  wb.setInput(id, 99, 0, 'gone');
  wb.deleteRows(id, 50, 50);
  expect(wb.getValue(id, 0, 0)).toBe('keep');
  expect(wb.sheet(id).rows).toBe(50);
  expect(wb.sheet(id).cells.size).toBe(1);
});
