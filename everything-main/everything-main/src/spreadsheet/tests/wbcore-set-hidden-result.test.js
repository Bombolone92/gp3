import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS } from '../src/core/workbook.js';

// Hiding lines was refused silently, leaving callers to compare the hidden sets themselves.
it('says whether the lines were hidden or shown', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const rows = MAX_ROWS; // every row of the grid
  expect(wb.setHidden(id, 'row', [1, 2], true)).toBe(true);
  expect(wb.isHidden(id, 'row', 2)).toBe(true);
  expect(wb.setHidden(id, 'row', [1, 2], true)).toBe(false); // already hidden
  expect(wb.setHidden(id, 'row', Array.from({ length: rows }, (_, i) => i), true)).toBe(false); // never every line
  expect(wb.isHidden(id, 'row', 0)).toBe(false);
  expect(wb.setHidden(id, 'row', [1, 2], false)).toBe(true);
  expect(wb.setHidden(id, 'col', [0], true)).toBe(true);
  wb.setSheetProtected(id, true);
  expect(wb.setHidden(id, 'col', [1], true)).toBe(false);
  expect(wb.setHidden('nope', 'col', [1], true)).toBe(false);
});
