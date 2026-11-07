import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Rows inserted right above a table's totals row join its data, and the table's
// filter grows to take them in. With a criteria filter active, reapplying it
// hid the new blank rows at once, so the user could not type into them; rows
// inserted among the data rows stayed in view. The new rows now stay in view
// until the filter is applied again, whichever place they were inserted at.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['N', 'V'], ['a', 1], ['b', 5], ['c', 7]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, parseRange('A1:B4'), { name: 'T' });
  wb.setTableTotals(id, tid, true);
  wb.setFilterCriteria(id, 1, { op: 'gt', value: 3 });
  return { wb, id };
}

it('keeps rows inserted above the totals row of a filtered table in view until the filter is applied again', () => {
  const { wb, id } = book();
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  expect(wb.insertRows(id, 4, 2)).toBe(true);
  expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:B6'));
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  expect([4, 5].map((r) => wb.isRowHidden(id, r))).toEqual([false, false]);
  expect(wb.getCell(id, 6, 1)?.f).toMatch(/SUBTOTAL/);
  // Applying the filter again hides the blank rows, which fail the criteria, as it would any other.
  wb.reapplyFilter(id);
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([1, 4, 5]);
  expect(wb.undoLabel()).toBe('Insert rows');
  wb.undo();
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:B4'));
});
