import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Remove empty rows kept a row only when the merge lay in the range's first column: one further right was
// deleted with its row, though the merged block was the row's content, and though a merge starting in the
// first column would have kept the row.
it('keeps a row whose only content is a merged block, wherever in the row it lies', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'a');
  wb.setInput(id, 2, 0, 'c');
  wb.mergeCells(id, { r1: 1, c1: 1, r2: 1, c2: 2 });
  expect(wb.removeEmptyRows(id, { r1: 0, c1: 0, r2: 2, c2: 2 })).toBe(0);
  expect(wb.sheet(id).merges).toEqual([{ r1: 1, c1: 1, r2: 1, c2: 2 }]);
  expect(wb.getValue(id, 2, 0)).toBe('c');
  // A merge in the first column keeps its row, as before; a block outside the range's columns counts too.
  wb.mergeCells(id, { r1: 4, c1: 0, r2: 4, c2: 1 });
  wb.mergeCells(id, { r1: 6, c1: 5, r2: 7, c2: 5 });
  wb.setInput(id, 9, 0, 'j');
  expect(wb.removeEmptyRows(id, { r1: 0, c1: 0, r2: 9, c2: 2 })).toBe(3);
  expect(wb.getValue(id, 6, 0)).toBe('j');
  expect(wb.sheet(id).merges).toEqual([{ r1: 1, c1: 1, r2: 1, c2: 2 }, { r1: 3, c1: 0, r2: 3, c2: 1 }, { r1: 4, c1: 5, r2: 5, c2: 5 }]);
});
