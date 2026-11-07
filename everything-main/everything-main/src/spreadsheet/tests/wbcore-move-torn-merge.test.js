import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };

// The grid grows a selection to the merges it touches, so only a caller of the workbook can ask for
// this, and it is refused.
describe('moving part of a merged block', () => {
  it('is refused, by dragging and by cut and paste, so the merge keeps its value', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'M');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    wb.clearHistory();
    const before = wb.toJSON();
    expect(wb.moveRange(id, A1, 5, 5)).toBeNull();
    expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 0, c2: 2 }, 5, 5)).toBeNull(); // a block straddling the merge
    expect(wb.placeMoved(id, 5, 5, wb.copyRange(id, A1), { sheetId: id, range: A1 })).toBeNull();
    const two = wb.addSheet('Two').id;
    expect(wb.placeMoved(two, 5, 5, wb.copyRange(id, A1), { sheetId: id, range: A1 })).toBeNull();
    wb.deleteSheet(two);
    expect(wb.toJSON()).toEqual(before);
    // The whole block moves, merge and all.
    expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, 5, 5)).toEqual({ r1: 5, c1: 5, r2: 6, c2: 6 });
    expect(wb.sheet(id).merges).toEqual([{ r1: 5, c1: 5, r2: 6, c2: 6 }]);
    expect(wb.getCell(id, 5, 5).v).toBe('M');
  });
});
