import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Creating a table over a range that already had a filter replaced the filter with an empty one,
// dropping its criteria and showing the rows it hid. A filter on exactly the table's range now
// carries its criteria and its hidden rows into the table; a filter over some other range still gives
// way to the table's own.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function filtered(range) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['N', 'V'], ['a', 1], ['b', 5], ['c', 7], ['d', 2]]));
  wb.setFilterRange(id, parseRange(range));
  wb.setFilterCriteria(id, 1, { op: 'gt', value: 3 });
  wb.clearHistory();
  const hidden = () => [...wb.sheet(id).filterHidden].sort();
  return { wb, id, hidden };
}

it('keeps the filter criteria and the hidden rows when the filtered range becomes a table', () => {
  const { wb, id, hidden } = filtered('A1:B5');
  expect(hidden()).toEqual([1, 4]);
  const tid = wb.addTable(id, parseRange('A1:B5'), { name: 'T' });
  expect(tid).toBeTruthy();
  expect(wb.sheet(id).filter).toMatchObject({ range: parseRange('A1:B5'), criteria: { 1: { op: 'gt', value: 3 } } });
  expect(hidden()).toEqual([1, 4]);
  // The table's filter goes on working: a row typed under it stays in view until the filter is applied again.
  wb.setInput(id, 5, 1, '2');
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B6'));
  expect(hidden()).toEqual([1, 4]);
  wb.reapplyFilter(id);
  expect(hidden()).toEqual([1, 4, 5]);
  wb.undo(); wb.undo();
  expect(wb.sheet(id).tables).toEqual([]);
  expect(wb.sheet(id).filter).toMatchObject({ range: parseRange('A1:B5'), criteria: { 1: { op: 'gt', value: 3 } } });
  expect(hidden()).toEqual([1, 4]);
});

it('keeps the rows in view that the filter had not hidden yet', () => {
  const { wb, id, hidden } = filtered('A1:B5');
  // A row that no longer meets the condition stays in view until the filter is applied again, as after any edit.
  wb.setCells(id, [{ r: 2, c: 1, cell: { v: 0 } }]);
  expect(hidden()).toEqual([1, 4]);
  wb.addTable(id, parseRange('A1:B5'), { name: 'T' });
  expect(hidden()).toEqual([1, 4]);
  wb.reapplyFilter(id);
  expect(hidden()).toEqual([1, 2, 4]);
});

it('starts afresh when the filter covered a different range', () => {
  const { wb, id, hidden } = filtered('A1:B4');
  expect(hidden()).toEqual([1]);
  wb.addTable(id, parseRange('A1:B5'), { name: 'T' });
  expect(wb.sheet(id).filter).toEqual({ range: parseRange('A1:B5'), criteria: {} });
  expect(hidden()).toEqual([]);
});
