import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A range too large to merge was silently ignored while the editor announced "Merged".
it('says whether the cells were merged', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(true);
  expect(wb.sheet(id).merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
  expect(wb.mergeCells(id, { r1: 0, c1: 0, r2: 19999, c2: 5 })).toBe(false);
  expect(wb.mergeCells(id, { r1: 5, c1: 5, r2: 5, c2: 5 })).toBe(false);
  expect(wb.sheet(id).merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
  expect(wb.undoLabel()).toBe('Merge cells');
});
