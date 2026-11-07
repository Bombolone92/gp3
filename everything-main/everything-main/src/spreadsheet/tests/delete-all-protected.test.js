import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Deleting every row trimmed the count before the protection check, so the
// last row was never checked and its protected cells were deleted anyway.
it('refuses to delete every row or column when the last one holds protected cells', () => {
  const wb = new Workbook({ sheets: [{ name: 'S', rows: 5, cols: 3, cells: { '4,0': { v: 'keep me' }, '0,0': { v: 'top' } } }] });
  const id = wb.activeSheetId;
  wb.protectRange(id, { r1: 4, c1: 0, r2: 4, c2: 0 });
  wb.deleteRows(id, 0, 5);
  expect(wb.getValue(id, 4, 0)).toBe('keep me');
  expect(wb.getValue(id, 0, 0)).toBe('top');
  expect(wb.sheets[0].protectedRanges.map((p) => p.range)).toEqual([{ r1: 4, c1: 0, r2: 4, c2: 0 }]);
  wb.deleteRows(id, 0, 99);
  expect(wb.getValue(id, 4, 0)).toBe('keep me');
  const wc = new Workbook({ sheets: [{ name: 'S', rows: 3, cols: 4, cells: { '0,3': { v: 'edge' } } }] });
  const cid = wc.activeSheetId;
  wc.protectRange(cid, { r1: 0, c1: 3, r2: 0, c2: 3 });
  wc.deleteCols(cid, 0, 4);
  expect(wc.getValue(cid, 0, 3)).toBe('edge');
  // Without protection the sheet still empties down to one default line.
  const wd = new Workbook({ sheets: [{ name: 'S', rows: 5, cols: 3, cells: { '4,0': { v: 'gone' }, '0,0': { v: 'top' } } }] });
  wd.deleteRows(wd.activeSheetId, 0, 5);
  expect(wd.sheets[0].cells.size).toBe(0);
});
