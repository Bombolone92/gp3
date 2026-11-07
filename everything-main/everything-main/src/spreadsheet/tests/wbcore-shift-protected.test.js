import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function grid() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) wb.setInput(id, r, c, `${'ABCD'[c]}${r + 1}`);
  return { wb, id };
}

// A protected range half inside the shifted band stayed where it was while its cells slid away,
// so a protected value landed on an unlocked cell and an unprotected value became locked.
describe('inserting or deleting cells beside a protected range', () => {
  it('refuses when the range would straddle the shifted band', () => {
    const { wb, id } = grid();
    wb.protectRange(id, { r1: 2, c1: 0, r2: 2, c2: 2 }, 'row 3'); // A3:C3
    expect(wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'down')).toBe(false);
    expect(wb.deleteCells(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'up')).toBe(false);
    expect(wb.insertCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, 'down')).toBe(false); // A:B, still short of C
    expect(wb.getCell(id, 2, 0).v).toBe('A3');
    expect(wb.lockedAt(id, 2, 0)).toBe(true);
    expect(wb.lockedAt(id, 3, 0)).toBe(false);
    expect(wb.sheet(id).protectedRanges.map((p) => p.range)).toEqual([{ r1: 2, c1: 0, r2: 2, c2: 2 }]);
    // Sideways too: A3:A4 straddles the band of row 3.
    wb.unprotectRange(id, wb.sheet(id).protectedRanges[0].id);
    wb.protectRange(id, { r1: 2, c1: 0, r2: 3, c2: 0 }, 'A3:A4');
    expect(wb.insertCells(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, 'right')).toBe(false);
    expect(wb.deleteCells(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, 'left')).toBe(false);
    expect(wb.getCell(id, 2, 1).v).toBe('B3');
  });

  it('moves a range wholly inside the band with its cells, and leaves one above the edit alone', () => {
    const { wb, id } = grid();
    wb.protectRange(id, { r1: 2, c1: 0, r2: 2, c2: 2 }, 'row 3'); // A3:C3
    wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, 'A1:B1');
    expect(wb.insertCells(id, { r1: 1, c1: 0, r2: 1, c2: 3 }, 'down')).toBe(true);
    expect(wb.getCell(id, 3, 0).v).toBe('A3');
    expect(wb.lockedAt(id, 3, 0)).toBe(true);
    expect(wb.lockedAt(id, 2, 0)).toBe(false);
    expect(wb.lockedAt(id, 0, 1)).toBe(true);
    expect(wb.sheet(id).protectedRanges.map((p) => p.range)).toEqual([{ r1: 3, c1: 0, r2: 3, c2: 2 }, { r1: 0, c1: 0, r2: 0, c2: 1 }]);
    expect(wb.deleteCells(id, { r1: 1, c1: 0, r2: 1, c2: 3 }, 'up')).toBe(true);
    expect(wb.sheet(id).protectedRanges.map((p) => p.range)).toEqual([{ r1: 2, c1: 0, r2: 2, c2: 2 }, { r1: 0, c1: 0, r2: 0, c2: 1 }]);
    expect(wb.getCell(id, 2, 0).v).toBe('A3');
  });
});
