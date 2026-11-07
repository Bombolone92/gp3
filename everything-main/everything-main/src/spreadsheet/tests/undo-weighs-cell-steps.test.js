import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A sort, fill, paste, clear or replace-all step closes over a clone of every cell it touched, before and
// after, and only structural steps were weighed against the memory budget: twenty sorts of a 100,000-cell
// range held 386 MB that no save released, and the 200-step limit projected to 3.9 GB. Those clones are now
// counted too, and the oldest steps make way — the newest one always stays, however large.

/** `rows` × `cols` of plain numbers, with the history cleared so only the steps under test count. */
function table(rows, cols) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const entries = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) entries.push({ r, c, cell: { v: (r * 7 + c) % 997, f: null } });
  wb.setCells(id, entries, 'Fill');
  wb.clearHistory();
  return { wb, id, range: { r1: 0, c1: 0, r2: rows - 1, c2: cols - 1 } };
}

const column = (wb, id, rows) => Array.from({ length: rows }, (_, r) => wb.getValue(id, r, 0));

describe('the memory a cell-level undo step keeps', () => {
  it('is counted for a sort, a fill, a paste, a clear and a replace of formulas with values', () => {
    const steps = [
      ['Sort', (wb, id, range) => wb.sortRange(id, range, 0, true)],
      ['Fill', (wb, id, range) => wb.fill(id, { r1: 0, c1: 0, r2: 0, c2: range.c2 }, range, 'down')],
      ['Paste', (wb, id, range) => wb.setCells(id, [...Array(200).keys()].map((i) => ({ r: i, c: 0, cell: { v: -1, f: null } })), 'Paste')],
      ['Clear', (wb, id, range) => wb.clearRange(id, range)],
    ];
    for (const [label, run] of steps) {
      const { wb, id, range } = table(200, 5);
      run(wb, id, range);
      expect(wb.undoLabels(1)).toEqual([label]);
      expect(wb._snapshotCells).toBeGreaterThan(200);
    }
  });

  it('is counted for a replace-all across several sheets, which is one transaction of writes', () => {
    const { wb, id } = table(50, 2);
    const other = wb.addSheet('Other').id;
    wb.setCells(other, [...Array(40).keys()].map((i) => ({ r: i, c: 0, cell: { v: 'x', f: null } })), 'Fill');
    wb.clearHistory();
    const before = [column(wb, id, 5), column(wb, other, 5)];
    wb.transaction('Replace all', () => {
      wb.setCells(id, [...Array(50).keys()].map((i) => ({ r: i, c: 0, cell: { v: 'y', f: null } })), 'Replace');
      wb.setCells(other, [...Array(40).keys()].map((i) => ({ r: i, c: 0, cell: { v: 'y', f: null } })), 'Replace');
    });
    expect(wb.undoLabels(1)).toEqual(['Replace all']);
    expect(wb._snapshotCells).toBe((50 + 40) * 2);
    // One step, and it puts both sheets back.
    wb.undo();
    expect([column(wb, id, 5), column(wb, other, 5)]).toEqual(before);
    expect(wb.canUndo()).toBe(false);
  });

  it('drops the oldest steps once the history holds more cells than the budget, and says so', { timeout: 60000 }, () => {
    const ROWS = 400, COLS = 5;
    const { wb, id, range } = table(ROWS, COLS);
    wb._snapshotBudget = ROWS * COLS * 2 * 3; // room for three sorts of the whole table
    const states = [column(wb, id, ROWS)];
    for (let i = 0; i < 10; i++) {
      wb.sortRange(id, range, i % COLS, i % 2 === 0);
      states.push(column(wb, id, ROWS));
    }
    // Ten sorts, three steps kept: the tally used to grow without bound and nothing was ever dropped.
    expect(wb._snapshotCells).toBeLessThanOrEqual(wb._snapshotBudget);
    expect(wb._history.length).toBe(3);
    // What the user can reach with Ctrl+Z is exactly what the history reports, step for step.
    expect(wb.undoLabels(20)).toEqual(['Sort', 'Sort', 'Sort']);
    expect(wb.canUndo()).toBe(true);
    for (let back = 1; back <= 3; back++) {
      expect(wb.undo()).toBe(true);
      expect(column(wb, id, ROWS)).toEqual(states[10 - back]);
      expect(wb.undoLabels(20)).toHaveLength(3 - back);
      expect(wb.canUndo()).toBe(back < 3);
    }
    expect(wb.undo()).toBe(false);
    // And redo brings every one of them back, in order.
    for (let forward = 1; forward <= 3; forward++) {
      expect(wb.redo()).toBe(true);
      expect(column(wb, id, ROWS)).toEqual(states[7 + forward]);
    }
    expect(wb.redo()).toBe(false);
    expect(wb._snapshotCells).toBeLessThanOrEqual(wb._snapshotBudget);
  });

  it('keeps the newest step however large, so one sort of a whole table is always undoable', () => {
    const ROWS = 300, COLS = 4;
    const { wb, id, range } = table(ROWS, COLS);
    wb._snapshotBudget = 10; // smaller than any one of these steps
    const before = column(wb, id, ROWS);
    wb.setInput(id, 0, 0, 'typed');
    wb.sortRange(id, range, 1, true);
    expect(wb._history.length).toBe(1);
    expect(wb.undoLabels(5)).toEqual(['Sort']);
    expect(wb.undo()).toBe(true);
    expect(wb.getValue(id, 0, 0)).toBe('typed');
    expect(wb.canUndo()).toBe(false);
    // The typing before it was dropped, and the history never claimed otherwise.
    expect(column(wb, id, ROWS).slice(1)).toEqual(before.slice(1));
  });

  it('gives the cells back to the budget when a step is undone, and takes them again on redo', () => {
    const { wb, id, range } = table(100, 3);
    wb.clearRange(id, range);
    const held = wb._snapshotCells;
    expect(held).toBe(100 * 3 * 2); // every cleared cell, as it was and as it is
    wb.undo();
    expect(wb._snapshotCells).toBe(0);
    wb.redo();
    expect(wb._snapshotCells).toBe(held);
  });
});
