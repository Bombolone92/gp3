import { describe, expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';

describe('a cell beyond the grid', () => {
  it('is refused by setInput and setCells, with no undo step', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const before = wb.toJSON();
    wb.setInput(id, MAX_ROWS, 0, 'y');
    wb.setInput(id, 0, MAX_COLS, 'z');
    wb.setInput(id, -1, 0, 'n');
    // Content bound outside the grid is left out and the rest of the batch is written; only a protected cell refuses the whole batch.
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null } }, { r: MAX_ROWS + 5, c: 0, cell: { v: 1, f: null } }])).toBe(1);
    expect(wb.getCell(id, 0, 0).v).toBe(1);
    expect(wb.getCell(id, MAX_ROWS + 5, 0)).toBeUndefined();
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
    // A blank bound there changes nothing, so it is left out and the rest of the batch is written.
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null } }, { r: MAX_ROWS + 5, c: 0, cell: null }, { r: 0, c: MAX_COLS, cell: { v: null, f: null } }])).toBe(1);
    expect(wb.getCell(id, 0, 0).v).toBe(1);
    expect(wb.getCell(id, MAX_ROWS + 5, 0)).toBeUndefined();
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    // The grid's last cell is still written, and the sheet grows to it.
    wb.setInput(id, MAX_ROWS - 1, MAX_COLS - 1, 'edge');
    expect(wb.getCell(id, MAX_ROWS - 1, MAX_COLS - 1).v).toBe('edge');
    expect(wb.sheet(id)).toMatchObject({ rows: MAX_ROWS, cols: MAX_COLS });
  });

  it('is where a pasted block is cut off: at the grid\'s edge', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const block = Array.from({ length: 3 }, (_, i) => [{ v: i, f: null }]);
    expect(wb.pasteCells(id, block, MAX_ROWS - 2, 0, { r: 0, c: 0 })).toEqual({ clippedRows: 1, clippedCols: 0 });
    expect(wb.getCell(id, MAX_ROWS - 1, 0).v).toBe(1);
    expect(wb.getCell(id, MAX_ROWS, 0)).toBeUndefined();
  });

  it('is not a cell of the grid\'s own size: the file format\'s A1:XFD1048576 is written on a sheet never scrolled there', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, MAX_ROWS - 50, MAX_COLS - 5, 'far');
    expect(wb.getCell(id, MAX_ROWS - 50, MAX_COLS - 5).v).toBe('far');
    wb.setInput(id, MAX_ROWS, 0, 'past');
    expect(wb.getCell(id, MAX_ROWS, 0)).toBeUndefined();
  });
});
