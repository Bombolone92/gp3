import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

it('stops a group at the grid, so collapsing it hides no lines past the last one and other lines can still be hidden', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(wb.groupLines(id, 'row', MAX_ROWS - 50, MAX_ROWS + 30000)).toBe(true);
  expect(wb.outlineGroups(id, 'row')).toEqual([{ from: MAX_ROWS - 50, to: MAX_ROWS - 1, collapsed: false, level: 1 }]);
  wb.toggleGroup(id, 'row', MAX_ROWS - 50, MAX_ROWS - 1);
  expect(wb.sheet(id).hiddenRows.size).toBe(50);
  expect(wb.setHidden(id, 'row', [3], true)).toBe(true);
  expect(wb.isHidden(id, 'row', 3)).toBe(true);
  expect(wb.groupLines(id, 'row', MAX_ROWS + 1, MAX_ROWS + 5)).toBe(false);
  expect(wb.groupLines(id, 'col', 2, MAX_COLS + 5000)).toBe(true);
  expect(wb.outlineGroups(id, 'col')).toEqual([{ from: 2, to: MAX_COLS - 1, collapsed: false, level: 1 }]);
});

it('still refuses to hide the last line the sheet shows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rows = MAX_ROWS; // every row of the grid, not only those reached so far
  expect(wb.setHidden(id, 'row', Array.from({ length: rows }, (_, i) => i), true)).toBe(false);
  expect(wb.setHidden(id, 'row', Array.from({ length: rows - 1 }, (_, i) => i + 1), true)).toBe(true);
  expect(wb.setHidden(id, 'row', [0], true)).toBe(false);
});

it('stops a protected range at the file grid instead of storing bounds no sheet has', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(wb.protectRange(id, { r1: 0, c1: 0, r2: 1e9, c2: 1e9 })).toBeTruthy();
  expect(wb.sheet(id).protectedRanges[0].range).toEqual({ r1: 0, c1: 0, r2: MAX_ROW, c2: MAX_COL });
  expect(wb.lockedAt(id, 25000, 0)).toBe(true);
  expect(wb.protectRange(id, { r1: 0, c1: 0, r2: NaN, c2: 0 })).toBeNull();
  expect(wb.sheet(id).protectedRanges).toHaveLength(1);
});
