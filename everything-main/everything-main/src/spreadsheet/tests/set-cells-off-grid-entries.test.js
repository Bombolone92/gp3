import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';

// setCells refused the whole batch when one entry lay past the grid's last row or column, so a caller that
// did not clip beforehand (paste and import do) lost its entire edit silently. The entries inside the grid
// are written and the others left out; a protected cell still refuses the whole batch.
it('writes the entries inside the grid and leaves out those past its edge', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 1, f: null } },
    { r: MAX_ROWS + 5, c: 0, cell: { v: 2, f: null } },
    { r: 0, c: MAX_COLS, cell: { v: 3, f: null } },
  ], 'x')).toBe(1);
  expect(wb.getValue(id, 0, 0)).toBe(1);
  expect(wb.sheet(id).cells.size).toBe(1);
  expect(wb.undoLabel()).toBe('x');
  // A batch with nothing inside the grid changes nothing and records no step.
  expect(wb.setCells(id, [{ r: MAX_ROWS, c: 0, cell: { v: 2, f: null } }], 'y')).toBe(0);
  expect(wb.undoLabel()).toBe('x');
  // One protected cell still keeps the whole batch out, so a paste never half-lands.
  wb.protectRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 });
  expect(wb.setCells(id, [{ r: 2, c: 0, cell: { v: 5, f: null } }, { r: 1, c: 0, cell: { v: 6, f: null } }], 'z')).toBe(0);
  expect(wb.getCell(id, 2, 0)).toBeUndefined();
  // The grid spans the full file-format size: its last row takes a value on a sheet that has not been scrolled there.
  const fresh = new Workbook();
  expect(fresh.setCells(fresh.activeSheetId, [{ r: MAX_ROWS - 1, c: MAX_COLS - 1, cell: { v: 1, f: null } }])).toBe(1);
});
