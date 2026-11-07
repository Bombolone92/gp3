import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';

/** Three short columns under a range that runs to the grid's last row, as a whole-column selection does. */
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['c', 'a', 'b'], [3, 1, 2], ['z', 'x', 'y']].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.setInput(id, 5, 4, '=A2+B2');
  // Count the cell lookups: a sort that walked a million empty rows would make millions of them.
  const sheet = wb.sheet(id);
  const get = sheet.cells.get.bind(sheet.cells);
  let reads = 0;
  sheet.cells.get = (key) => { reads++; return get(key); };
  return { wb, id, reads: () => reads, range: { r1: 0, c1: 0, r2: MAX_ROW, c2: 2 } };
}

it('sorts the columns of a whole-column range by reading only the rows in use', () => {
  const { wb, id, reads, range } = book();
  expect(wb.sortColumnsBy(id, range, [{ row: 0, ascending: true }])).toBe(true);
  expect([0, 1, 2].map((c) => wb.getValue(id, 0, c))).toEqual(['a', 'b', 'c']);
  expect([0, 1, 2].map((c) => wb.getValue(id, 2, c))).toEqual(['x', 'y', 'z']);
  expect(wb.getValue(id, 5, 4)).toBe(3);
  expect(reads()).toBeLessThan(1000);
});

it('sorts the rows of a whole-column range by reading only the rows in use', () => {
  const { wb, id, reads, range } = book();
  expect(wb.sortRangeBy(id, range, [{ col: 0, ascending: true }])).toBe(true);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([3, 'c', 'z']);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 2))).toEqual([2, 'b', 'y']);
  expect(reads()).toBeLessThan(1000);
  // An entirely blank range has nothing to sort and leaves no undo step.
  wb.clearHistory();
  expect(wb.sortRangeBy(id, { r1: 50, c1: 0, r2: MAX_ROW, c2: 2 }, [{ col: 0 }])).toBe(true);
  expect(wb.canUndo()).toBe(false);
});
