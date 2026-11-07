import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';

const block = (rows, cols) => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => ({ v: i * cols + j + 1 })));

it('reports how many rows and columns of a paste fell past the sheet edge', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(wb.pasteCells(id, block(3, 2), MAX_ROWS - 1, MAX_COLS - 1)).toEqual({ clippedRows: 2, clippedCols: 1 });
  expect(wb.getValue(id, MAX_ROWS - 1, MAX_COLS - 1)).toBe(1);
  expect(wb.pasteCells(id, block(2, 2), 0, 0)).toEqual({ clippedRows: 0, clippedCols: 0 });
  expect(wb.pasteCells(id, block(1, 3), MAX_ROWS - 1, 0, null, null, { transpose: true })).toEqual({ clippedRows: 2, clippedCols: 0 });
  // A block tiled over a target counts the tiles that fell off too.
  expect(wb.pasteCells(id, block(1, 1), MAX_ROWS - 2, 0, null, { r1: MAX_ROWS - 2, c1: 0, r2: MAX_ROWS + 1, c2: 0 })).toEqual({ clippedRows: 2, clippedCols: 0 });
});
