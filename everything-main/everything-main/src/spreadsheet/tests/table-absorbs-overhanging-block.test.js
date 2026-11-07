import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A table only took in a block that began on the row immediately under it. A paste, a Ctrl+Enter or a
// Ctrl+D that started inside the table and ran past its end left the overhanging rows outside it: no
// banding, no calculated column, not in T[Amt] and not in a chart or rule that follows the table. A block
// that reaches past the last row is now taken in wherever it starts, as long as it starts on a data row.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Qty', 'Dbl'], ['a', 1], ['b', 2]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const tid = wb.addTable(id, parseRange('A1:C3'), { name: 'T' });
  wb.setInput(id, 1, 2, '=[@Qty]*2');
  const row = (r) => [0, 1, 2].map((c) => wb.getCell(id, r, c)?.f ?? wb.getValue(id, r, c) ?? null);
  const paste = (rows, at) => wb.setCells(id, rows.flatMap((values, i) => values.map((v, c) => ({ r: at + i, c, cell: { v } }))), 'Paste');
  return { wb, id, tid, row, paste, range: () => wb.tableById(id, tid).range };
}

describe('a block that runs past a table\'s last row', () => {
  it('is taken in by a paste that starts on the last data row', () => {
    const { wb, id, row, paste, range } = book();
    paste([['c', 3], ['d', 4], ['e', 5]], 2);
    expect(wb.extendTableToCover(id, parseRange('A3:B5'))).toBe(true);
    expect(range()).toEqual(parseRange('A1:C5'));
    expect([2, 3, 4].map(row)).toEqual([['c', 3, '[@Qty]*2'], ['d', 4, '[@Qty]*2'], ['e', 5, '[@Qty]*2']]);
    expect(wb.getValue(id, 4, 2)).toBe(10);
  });

  it('is taken in by a tiled paste, whose block repeats the clipboard down the selection', () => {
    const { wb, id, row, paste, range } = book();
    paste([['c', 3], ['c', 3], ['c', 3]], 2); // one clipboard row tiled over A3:B5
    expect(wb.extendTableToCover(id, parseRange('A3:B5'))).toBe(true);
    expect(range()).toEqual(parseRange('A1:C5'));
    expect([3, 4].map(row)).toEqual([['c', 3, '[@Qty]*2'], ['c', 3, '[@Qty]*2']]);
  });

  it('is taken in by Ctrl+Enter over a range spanning the last row', () => {
    const { wb, id, row, range } = book();
    wb.fillInput(id, parseRange('A3:B5'), '9', { r: 2, c: 0 });
    expect(range()).toEqual(parseRange('A1:C5'));
    expect([3, 4].map(row)).toEqual([[9, 9, '[@Qty]*2'], [9, 9, '[@Qty]*2']]);
  });

  it('is taken in by Ctrl+D whose source row lies inside the table', () => {
    const { wb, id, row, range } = book();
    wb.fillDirection(id, parseRange('A2:B5'), 'down');
    expect(range()).toEqual(parseRange('A1:C5'));
    expect([3, 4].map(row)).toEqual([['a', 1, '[@Qty]*2'], ['a', 1, '[@Qty]*2']]);
  });

  it('fills the calculated column of the rows that just joined, not of those already in the table', () => {
    const { wb, id, row, paste, range } = book();
    wb.setCells(id, [{ r: 2, c: 2, cell: null }], 'Clear'); // the last data row's Dbl cell, left empty by hand
    paste([['c', 3], ['d', 4]], 2);
    expect(wb.extendTableToCover(id, parseRange('A3:B4'))).toBe(true);
    expect(range()).toEqual(parseRange('A1:C4'));
    expect([2, 3].map(row)).toEqual([['c', 3, null], ['d', 4, '[@Qty]*2']]);
  });

  it('grows nothing for a block wholly inside the table, or one starting on its header row', () => {
    const { wb, id, range } = book();
    expect(wb.extendTableToCover(id, parseRange('A2:B3'))).toBe(false);
    expect(wb.extendTableToCover(id, parseRange('A1:B5'))).toBe(false);
    expect(wb.extendTableToCover(id, parseRange('A5:B7'))).toBe(false); // a gap below the table
    expect(range()).toEqual(parseRange('A1:C3'));
  });

  it('does not widen the table, however wide the block is', () => {
    const { wb, id, paste, range } = book();
    paste([['c', 3, 6, 'x'], ['d', 4, 8, 'y']], 3);
    expect(wb.extendTableToCover(id, parseRange('A4:D5'))).toBe(true);
    expect(range()).toEqual(parseRange('A1:C5'));
  });

  it('takes nothing in below a table with a totals row', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Item', 'Qty'], ['a', 1], ['b', 2]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
    const tid = wb.addTable(id, parseRange('A1:B3'), { name: 'T', totalsRow: true });
    expect(wb.extendTableToCover(id, parseRange('A3:B6'))).toBe(false);
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B4'));
  });
});
