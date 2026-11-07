import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function frozen() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Title');
  wb.setInput(id, 1, 0, 'Header');
  wb.setInput(id, 2, 0, 'data');
  wb.setFrozen(id, 2, 1);
  wb.clearHistory();
  return { wb, id };
}

it('keeps the frozen pane ending at the same content when rows or columns are inserted', () => {
  const { wb, id } = frozen();
  wb.insertRows(id, 0, 1);
  expect(wb.sheet(id).frozenRows).toBe(3);
  expect(wb.getValue(id, 2, 0)).toBe('Header');
  wb.insertRows(id, 3, 5); // below the pane: unchanged
  expect(wb.sheet(id).frozenRows).toBe(3);
  wb.insertCols(id, 0, 2);
  expect(wb.sheet(id).frozenCols).toBe(3);
  wb.insertCols(id, 3, 1);
  expect(wb.sheet(id).frozenCols).toBe(3);
  wb.undo(); wb.undo(); wb.undo(); wb.undo();
  expect([wb.sheet(id).frozenRows, wb.sheet(id).frozenCols]).toEqual([2, 1]);
});

it('shrinks the frozen pane when frozen rows or columns are deleted', () => {
  const { wb, id } = frozen();
  wb.deleteRows(id, 0, 1);
  expect(wb.sheet(id).frozenRows).toBe(1);
  expect(wb.getValue(id, 0, 0)).toBe('Header');
  wb.deleteRows(id, 0, 5); // through the pane and beyond
  expect(wb.sheet(id).frozenRows).toBe(0);
  wb.deleteCols(id, 0, 1);
  expect(wb.sheet(id).frozenCols).toBe(0);
  wb.undo();
  expect(wb.sheet(id).frozenCols).toBe(1);
});

it('leaves the pane alone for edits below or right of it', () => {
  const { wb, id } = frozen();
  wb.deleteRows(id, 2, 3);
  wb.deleteCols(id, 1, 2);
  expect([wb.sheet(id).frozenRows, wb.sheet(id).frozenCols]).toEqual([2, 1]);
});
