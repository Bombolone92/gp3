import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Every edit dropped the sheet's cell bounds, so the used range was found again by scanning every
// cell: 371 ms per edit on a million cells.
describe('the last row and column holding content', () => {
  it('follows a cell edit without scanning the sheet again', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 3, 2, 'x');
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 3, c2: 2 });
    wb.setInput(id, 7, 1, 'y'); // extends the rows
    expect(wb._cellBoundsCache.get(id)).toEqual({ r2: 7, c2: 2 });
    wb.setInput(id, 1, 5, 'z'); // extends the columns
    expect(wb._cellBoundsCache.get(id)).toEqual({ r2: 7, c2: 5 });
    wb.setInput(id, 0, 0, 'inside');
    expect(wb._cellBoundsCache.get(id)).toEqual({ r2: 7, c2: 5 });
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 7, c2: 5 });
    // Clearing a cell on the edge needs a fresh look, and gets one.
    wb.setInput(id, 7, 1, '');
    expect(wb._cellBoundsCache.get(id)).toBeUndefined();
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 3, c2: 5 });
    wb.setInput(id, 0, 0, '');
    expect(wb._cellBoundsCache.get(id)).toEqual({ r2: 3, c2: 5 });
    wb.undo();
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 3, c2: 5 });
    wb.undo();
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 7, c2: 5 });
  });

  it('is right after a batch that both adds and clears cells', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 2, c: 2, cell: { v: 1, f: null } }, { r: 9, c: 0, cell: { v: 2, f: null } }]);
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 9, c2: 2 });
    wb.setCells(id, [{ r: 9, c: 0, cell: null }, { r: 4, c: 6, cell: { v: 3, f: null } }]);
    expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 4, c2: 6 });
    wb.setCells(id, [{ r: 4, c: 6, cell: null }, { r: 2, c: 2, cell: null }]);
    expect(wb.usedRange(id)).toBeNull();
  });
});
