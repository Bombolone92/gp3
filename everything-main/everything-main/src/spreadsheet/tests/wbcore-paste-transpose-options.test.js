import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const ROW = { r1: 0, c1: 0, r2: 0, c2: 2 };

describe('a transposed paste', () => {
  it('skips blank copied cells when asked, as an ordinary paste does', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 0, 2, '3');
    wb.setInput(id, 6, 0, 'keep', { style: { bold: true } });
    wb.pasteCells(id, wb.copyRange(id, ROW), 5, 0, { r: 0, c: 0 }, null, { transpose: true, skipBlanks: true });
    expect(wb.getValue(id, 5, 0)).toBe(1);
    expect(wb.getCell(id, 6, 0)).toMatchObject({ v: 'keep', s: { bold: true } });
    expect(wb.getValue(id, 7, 0)).toBe(3);
  });

  it('keeps the formatting already at the target when asked, as an ordinary paste does', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 0, 2, '3', { style: { bold: true } });
    wb.setInput(id, 5, 0, 'was', { style: { italic: true } });
    wb.setInput(id, 6, 0, 'x', { style: { bg: '#ffff00' } });
    wb.pasteCells(id, wb.copyRange(id, ROW), 5, 0, { r: 0, c: 0 }, null, { transpose: true, keepStyles: true });
    expect(wb.getCell(id, 5, 0)).toMatchObject({ v: 1, s: { italic: true } });
    // A blank copied cell clears the target's content and leaves its formatting.
    expect(wb.getCell(id, 6, 0)).toEqual({ v: null, f: null, s: { bg: '#ffff00' } });
    expect(wb.getCell(id, 7, 0).v).toBe(3);
    expect(wb.getCell(id, 7, 0).s).toBeUndefined();
  });
});
