import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Sorting, shuffling or removing duplicates over some of a table's columns moved
// those columns alone, tearing every record of the table apart. A table's row is
// the unit: a selection inside the table now moves whole rows, and
// a selection reaching past one of the table's sides is refused.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['N', 'V', 'Note'], ['c', 3, 'x'], ['a', 1, 'y'], ['b', 2, 'z']].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.addTable(id, parseRange('A1:B4'), { name: 'T' });
  return { wb, id };
}
const rows = (wb, id) => [1, 2, 3].map((r) => [0, 1, 2].map((c) => wb.getValue(id, r, c)));

describe('row tools over some of a table\'s columns', () => {
  it('sort the whole table row when the range lies inside the table', () => {
    const { wb, id } = book();
    expect(wb.rearrangeBlocker(id, parseRange('A2:A4'))).toBeNull();
    expect(wb.sortRangeBy(id, parseRange('A1:A4'), [{ col: 0, ascending: true }])).toBe(true);
    expect(rows(wb, id)).toEqual([['a', 1, 'x'], ['b', 2, 'y'], ['c', 3, 'z']]);
    expect(wb.sortRangeBy(id, parseRange('B2:B4'), [{ col: 1, ascending: false }])).toBe(true);
    expect(rows(wb, id)).toEqual([['c', 3, 'x'], ['b', 2, 'y'], ['a', 1, 'z']]);
  });

  it('shuffle and remove duplicates by whole table rows too', () => {
    const { wb, id } = book();
    wb.shuffleRows(id, parseRange('A2:A4'), { random: () => 0 });
    for (const [n, v] of rows(wb, id)) expect(v).toBe({ a: 1, b: 2, c: 3 }[n]);
    wb.setCells(id, [{ r: 3, c: 0, cell: { v: 'a' } }, { r: 3, c: 1, cell: { v: 1 } }]); // row 4 now duplicates row 2
    expect(wb.removeDuplicates(id, parseRange('A2:A4'))).toBe(1);
    expect(rows(wb, id).map(([n, v]) => `${n}${v}`).sort()).toEqual(['a1', 'b2', 'nullnull']);
  });

  it('judge duplicates by the columns selected, though the whole table row moves', () => {
    const { wb, id } = book();
    wb.setCells(id, [{ r: 2, c: 0, cell: { v: 'c' } }]); // rows 2 and 3 now share N = c but differ in V
    expect(wb.removeDuplicates(id, parseRange('A2:A4'))).toBe(1);
    expect(rows(wb, id)).toEqual([['c', 3, 'x'], ['b', 2, 'y'], [null, null, 'z']]);
    const { wb: w2, id: i2 } = book();
    w2.setCells(i2, [{ r: 2, c: 0, cell: { v: 'c' } }]);
    expect(w2.removeDuplicates(i2, parseRange('A2:B4'))).toBe(0);
  });

  it('are refused when the range reaches past one side of the table', () => {
    const { wb, id } = book();
    const before = JSON.stringify(wb.toJSON());
    expect(wb.rearrangeBlocker(id, parseRange('B2:C4'))).toBe('table');
    expect(wb.sortRangeBy(id, parseRange('B2:C4'), [{ col: 1, ascending: true }])).toBe(false);
    expect(wb.shuffleRows(id, parseRange('B2:C4'))).toBe(0);
    expect(wb.removeDuplicates(id, parseRange('B2:C4'))).toBe(false);
    expect(JSON.stringify(wb.toJSON())).toBe(before);
    // A range covering the whole table and more moves each row together, as before.
    expect(wb.sortRangeBy(id, parseRange('A2:C4'), [{ col: 0, ascending: true }])).toBe(true);
    expect(rows(wb, id)).toEqual([['a', 1, 'y'], ['b', 2, 'z'], ['c', 3, 'x']]);
  });

  it('checks protection over the table row that will move, not only the columns selected', () => {
    const { wb, id } = book();
    wb.protectRange(id, parseRange('B3'));
    expect(wb.rearrangeBlocker(id, parseRange('A2:A4'))).toBe('protected');
    expect(wb.sortRangeBy(id, parseRange('A2:A4'), [{ col: 0, ascending: true }])).toBe(false);
  });
});
