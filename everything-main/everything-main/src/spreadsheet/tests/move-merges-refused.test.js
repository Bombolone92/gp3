import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Part of a merged cell cannot change: sorting rows through a merge is refused, and so is
// moving part of one. Dragging a row or column header through a merged block silently dropped the merge,
// and dragging or cutting a block onto part of a merge silently unmerged it.
describe('moves that would cut through a merged block', () => {
  const merged = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.mergeCells(id, { r1: 2, c1: 1, r2: 4, c2: 3 }); // B3:D5
    wb.setInput(id, 2, 1, 'title');
    wb.setInput(id, 0, 0, 'x');
    const merge = () => wb.sheet(id).merges;
    return { wb, id, merge };
  };

  it('refuses a row or column move that would split the merge, and keeps it whole otherwise', () => {
    const { wb, id, merge } = merged();
    const steps = wb.undoLabels().length;
    expect(wb.moveRows(id, 3, 1, 10)).toBeNull(); // a row out of the middle
    expect(wb.moveRows(id, 0, 1, 4)).toBeNull(); // a row landing inside
    expect(wb.moveCols(id, 2, 1, 0)).toBeNull(); // a column out of the middle
    expect(wb.moveCols(id, 0, 1, 3)).toBeNull(); // a column landing inside
    expect(merge()).toEqual([{ r1: 2, c1: 1, r2: 4, c2: 3 }]);
    expect(wb.getValue(id, 2, 1)).toBe('title');
    expect(wb.undoLabels().length).toBe(steps); // nothing recorded
    // The whole merge moves with its rows; rows moved past it leave it alone.
    expect(wb.moveRows(id, 2, 3, 10)).toBe(7);
    expect(merge()).toEqual([{ r1: 7, c1: 1, r2: 9, c2: 3 }]);
    expect(wb.getValue(id, 7, 1)).toBe('title');
    expect(wb.moveRows(id, 0, 1, 20)).toBe(19);
    expect(merge()).toEqual([{ r1: 6, c1: 1, r2: 8, c2: 3 }]);
  });

  it('refuses dragging a block onto part of the merge, and unmerges one the block covers whole', () => {
    const { wb, id, merge } = merged();
    expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 3, 2)).toBeNull(); // one cell landing inside
    expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, 1, 0)).toBeNull(); // a block overlapping its corner
    expect(merge()).toEqual([{ r1: 2, c1: 1, r2: 4, c2: 3 }]);
    expect(wb.getValue(id, 0, 0)).toBe('x');
    // A block covering the whole merge replaces it, as pasting over a merged cell does.
    for (let r = 10; r <= 13; r++) for (let c = 0; c <= 3; c++) wb.setInput(id, r, c, `${r},${c}`);
    expect(wb.moveRange(id, { r1: 10, c1: 0, r2: 13, c2: 3 }, 1, 1)).toEqual({ r1: 1, c1: 1, r2: 4, c2: 4 });
    expect(merge()).toEqual([]);
    expect(wb.getValue(id, 2, 1)).toBe('11,0');
  });

  it('refuses a cut block pasted onto part of the merge, on the same sheet and on another', () => {
    const { wb, id, merge } = merged();
    const two = wb.addSheet('Two').id;
    wb.mergeCells(two, { r1: 6, c1: 6, r2: 7, c2: 7 });
    const src = { r1: 0, c1: 0, r2: 1, c2: 1 };
    const cells = wb.copyRange(id, src);
    expect(wb.placeMoved(id, 1, 0, cells, { sheetId: id, range: src })).toBeNull(); // lands on B3, the merge's corner
    expect(wb.placeMoved(two, 5, 5, cells, { sheetId: id, range: src })).toBeNull(); // lands on G7, the other sheet's merge
    expect(merge()).toEqual([{ r1: 2, c1: 1, r2: 4, c2: 3 }]);
    expect(wb.sheet(two).merges).toEqual([{ r1: 6, c1: 6, r2: 7, c2: 7 }]);
    expect(wb.getValue(id, 0, 0)).toBe('x');
    // Beside the merge the move goes through, and a merge the block covers whole gives way.
    expect(wb.placeMoved(two, 6, 6, cells, { sheetId: id, range: src })).toEqual({ r1: 6, c1: 6, r2: 7, c2: 7 });
    expect(wb.sheet(two).merges).toEqual([]);
    expect(wb.getValue(two, 6, 6)).toBe('x');
  });
});
