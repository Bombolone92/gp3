import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Inserting or deleting cells whose band cut through a merged block used to
// drop the merge silently. The operation is now refused.
describe('inserting and deleting cells across a merged block', () => {
  it('refuses when a merge straddles the band and leaves the merge alone', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    wb.setInput(id, 0, 0, 'title');
    const version = wb.version;
    expect(wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'down')).toBe(false);
    expect(wb.deleteCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'up')).toBe(false);
    expect(wb.insertCells(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, 'right')).toBe(false);
    expect(wb.sheet(id).merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
    expect(wb.version).toBe(version);
  });

  it('still shifts a merge that lies wholly inside the band', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, 'down')).toBe(true);
    expect(wb.sheet(id).merges).toEqual([{ r1: 1, c1: 0, r2: 2, c2: 1 }]);
  });
});
