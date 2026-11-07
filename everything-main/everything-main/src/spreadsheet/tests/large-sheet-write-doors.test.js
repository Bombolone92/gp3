import { describe, it, expect } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';

/**
 * A sheet a file brought in larger than the rows reached so far writes anywhere on the full grid. Typing and pasting already respected them; dragging a block, cut-and-paste and
 * Paste Special → Add stopped at the cap and said nothing.
 */
function imported() {
  const cells = {};
  for (let r = 25000; r <= 25001; r++) for (let c = 0; c <= 1; c++) cells[`${r},${c}`] = { v: r * 10 + c, f: null };
  const wb = new Workbook({ sheets: [{ name: 'Big', rows: 40000, cols: 26, cells }] });
  return { wb, id: wb.sheets[0].id };
}

describe('write doors on a sheet larger than the growth caps', () => {
  it('pastes an arithmetic operation past the cap', () => {
    const { wb, id } = imported();
    expect(wb.pasteOperation(id, [[10]], 25000, 0, 'add')).toBe(1);
    expect(wb.getValue(id, 25000, 0)).toBe(250010);
    wb.undo();
    expect(wb.getValue(id, 25000, 0)).toBe(250000);
  });

  it('drags a block past the cap', () => {
    const { wb, id } = imported();
    expect(wb.moveRange(id, { r1: 25000, c1: 0, r2: 25001, c2: 1 }, 26000, 0))
      .toEqual({ r1: 26000, c1: 0, r2: 26001, c2: 1 });
    expect(wb.getValue(id, 26000, 0)).toBe(250000);
    expect(wb.getCell(id, 25000, 0)).toBeUndefined();
    wb.undo();
    expect(wb.getValue(id, 25000, 0)).toBe(250000);
  });

  it('finishes a cut past the cap', () => {
    const { wb, id } = imported();
    const src = { r1: 25000, c1: 0, r2: 25001, c2: 1 };
    const cells = wb.copyRange(id, src);
    expect(wb.placeMoved(id, 26000, 0, cells, { sheetId: id, range: src }))
      .toEqual({ r1: 26000, c1: 0, r2: 26001, c2: 1 });
    expect(wb.getValue(id, 26001, 1)).toBe(250011);
    expect(wb.getCell(id, 25001, 1)).toBeUndefined();
  });

  it('still refuses a write past the grid\'s last row', () => {
    const { wb, id } = imported();
    const src = { r1: 25000, c1: 0, r2: 25001, c2: 1 };
    expect(wb.moveRange(id, src, MAX_ROWS - 1, 0)).toBe(null);
    expect(wb.placeMoved(id, MAX_ROWS - 1, 0, wb.copyRange(id, src), { sheetId: id, range: src })).toBe(null);
    expect(wb.pasteOperation(id, [[10]], MAX_ROWS, 0, 'add')).toBe(0);
  });

  it('keeps the interactive caps on an ordinary sheet', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '1');
    expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, MAX_ROWS, 0)).toBe(null);
    expect(wb.pasteOperation(id, [[10]], 0, MAX_COLS, 'add')).toBe(0);
  });
});
