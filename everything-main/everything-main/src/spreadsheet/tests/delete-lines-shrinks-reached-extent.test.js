import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The extent a sheet was scrolled to is kept through structural undo and redo, so the viewport is never
// left past the sheet's end. It was never lowered, so once rows were deleted on a sheet scrolled beyond
// them, any later structural undo or redo grew the sheet back to the old extent.
describe('the scrolled extent after lines are deleted', () => {
  it('no longer grows the sheet back after deleting every row', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.ensureSize(id, 5000, 26);
    wb.deleteRows(id, 0, 5000);
    expect(wb.sheet(id).rows).toBe(100);
    wb.insertRows(id, 0, 1);
    expect(wb.sheet(id).rows).toBe(101);
    wb.undo();
    expect(wb.sheet(id).rows).toBe(100);
    wb.redo();
    expect(wb.sheet(id).rows).toBe(101);
    // Undoing the deletion itself still brings the rows back.
    wb.undo(); wb.undo();
    expect(wb.sheet(id).rows).toBe(5000);
  });

  it('follows a block of deleted rows or columns on a sheet scrolled beyond them', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.ensureSize(id, 300, 40);
    wb.deleteRows(id, 10, 50);
    wb.deleteCols(id, 0, 10);
    expect([wb.sheet(id).rows, wb.sheet(id).cols]).toEqual([250, 30]);
    wb.setInput(id, 0, 0, 'x');
    wb.insertCols(id, 0, 1);
    wb.undo();
    expect([wb.sheet(id).rows, wb.sheet(id).cols]).toEqual([250, 30]);
    wb.redo();
    expect([wb.sheet(id).rows, wb.sheet(id).cols]).toEqual([250, 31]);
    // Scrolling further afterwards is kept again, as before.
    wb.ensureSize(id, 400, 31);
    wb.undo();
    expect([wb.sheet(id).rows, wb.sheet(id).cols]).toEqual([400, 31]);
  });
});
