import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A running total written with OFFSET names no cell but its own, so the chain could not be walked
// from the bottom: read from the bottom — by Ctrl+End, by scrolling there, by printing or by
// exporting — the whole column answered #ERROR!, and the right numbers only when it happened to be
// read from the top. The two never agreed within one calculation, since the wrong value was cached.

const ROWS = 3000;

function book(formula, { cols = 4, extra = null } = {}) {
  const cells = {};
  for (let r = 0; r < ROWS; r++) {
    cells[`${r},0`] = { v: 1 };
    cells[`${r},1`] = { f: r === 0 ? 'A1' : formula(r + 1) };
    if (extra) cells[`${r},2`] = { f: extra(r + 1) };
  }
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: ROWS + 5, cols, cells }] });
  return { wb, id: wb.activeSheetId };
}

describe('a running total whose link is an address the formula works out', () => {
  it.each([
    ['the previous row', (r) => `OFFSET(B${r},-1,0)+A${r}`],
    ['the top of the column', (r) => `OFFSET($B$1,ROW()-2,0)+A${r}`],
    ['INDIRECT', (r) => `INDIRECT("B"&(ROW()-1))+A${r}`],
  ])('reads the same from either end when it refers back through %s', (_, formula) => {
    const bottomFirst = book(formula);
    expect(bottomFirst.wb.getValue(bottomFirst.id, ROWS - 1, 1)).toBe(ROWS);

    const topFirst = book(formula);
    for (let r = 0; r < ROWS; r++) topFirst.wb.getValue(topFirst.id, r, 1);
    expect(topFirst.wb.getValue(topFirst.id, ROWS - 1, 1)).toBe(ROWS);

    const middleFirst = book(formula);
    expect(middleFirst.wb.getValue(middleFirst.id, ROWS / 2 - 1, 1)).toBe(ROWS / 2);
    expect(middleFirst.wb.getValue(middleFirst.id, ROWS - 1, 1)).toBe(ROWS);
  }, 60000);

  it('follows an edit of what it totals, read from the bottom each time', () => {
    const { wb, id } = book((r) => `OFFSET(B${r},-1,0)+A${r}`);
    expect(wb.getValue(id, ROWS - 1, 1)).toBe(ROWS);
    wb.setInput(id, 0, 0, '11');
    expect(wb.getValue(id, ROWS - 1, 1)).toBe(ROWS + 10);
    expect(wb.getValue(id, 0, 1)).toBe(11);
    wb.setInput(id, ROWS - 1, 0, '5');
    expect(wb.getValue(id, ROWS - 1, 1)).toBe(ROWS + 14);
    wb.undo();
    expect(wb.getValue(id, ROWS - 1, 1)).toBe(ROWS + 10);
    wb.undo();
    expect(wb.getValue(id, ROWS - 1, 1)).toBe(ROWS);
  }, 60000);

  it('carries a chain that leans on another column, and is read across sheets', () => {
    // C totals itself through OFFSET while taking B, which is a formula of its own.
    const cells = {};
    for (let r = 0; r < ROWS; r++) {
      cells[`${r},0`] = { v: 1 };
      cells[`${r},1`] = { f: `A${r + 1}*2` };
      cells[`${r},2`] = { f: r === 0 ? 'B1' : `OFFSET(C${r + 1},-1,0)+B${r + 1}` };
    }
    const wb = new Workbook({ sheets: [
      { name: 'Data', rows: ROWS + 5, cols: 6, cells },
      { name: 'Report', rows: 5, cols: 3, cells: { '0,0': { f: `Data!C${ROWS}*2` } } },
    ] });
    expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(ROWS * 4);
    expect(wb.getValue(wb.sheets[0].id, ROWS - 1, 2)).toBe(ROWS * 2);
  }, 60000);

  it('still calls a real circle of OFFSET references a cycle', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 4, 1, '=OFFSET(B5,0,0)+1');
    expect(wb.getValue(id, 4, 1)).toEqual({ error: '#CYCLE!' });
    wb.setInput(id, 0, 1, '=OFFSET(B2,0,0)+1');
    wb.setInput(id, 1, 1, '=OFFSET(B1,0,0)+1');
    expect(wb.getValue(id, 0, 1)).toEqual({ error: '#CYCLE!' });
    expect(wb.getValue(id, 1, 1)).toEqual({ error: '#CYCLE!' });
  });
});
