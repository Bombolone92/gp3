import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Text to columns split each cell with the clipboard's CSV parser, which takes a line break for a
// row break, and kept the first row alone: a cell holding "a,b⏎c,d" (Alt+Enter inside the cell)
// became a and b, and "c,d" was lost without a word. A line break inside a cell is part of its
// field; only the delimiter, outside quotes, splits.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));
const row = (wb, id, r, n) => Array.from({ length: n }, (_, c) => wb.getValue(id, r, c));

it('keeps a line break inside a piece instead of dropping everything after it', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['a,b\nc,d'], ['e\r\nf,g'], ['"x\ny",z']]));
  expect(wb.splitTextToColumns(id, parseRange('A1:A3'), ',')).toEqual({ rows: 3, cols: 3 });
  expect(row(wb, id, 0, 4)).toEqual(['a', 'b\nc', 'd', null]);
  expect(row(wb, id, 1, 3)).toEqual(['e\r\nf', 'g', null]);
  // Quoted fields keep their delimiter and their line break alike.
  expect(row(wb, id, 2, 3)).toEqual(['x\ny', 'z', null]);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe('a,b\nc,d');
});

it('detects the delimiter across the cell, not the first line only', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['name\nmore;1;2']]));
  expect(wb.splitTextToColumns(id, parseRange('A1:A1'))).toEqual({ rows: 1, cols: 3 });
  expect(row(wb, id, 0, 3)).toEqual(['name\nmore', 1, 2]);
});
