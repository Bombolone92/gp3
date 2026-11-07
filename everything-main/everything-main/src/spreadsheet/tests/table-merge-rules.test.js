import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book({ totals = false } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt', 'Note'], ['x', 5, 'a'], ['y', 7, 'b']]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'T', totalsRow: totals });
  wb.clearHistory();
  return { wb, id, tid };
}

it.each([
  ['data row', { r1: 1, c1: 0, r2: 1, c2: 1 }],
  ['column of data rows', { r1: 1, c1: 2, r2: 2, c2: 2 }],
  ['range reaching into the table', { r1: 2, c1: 1, r2: 4, c2: 3 }],
])('refuses to merge a %s of a table', (_, range) => {
  const { wb, id } = book();
  const before = wb.toJSON();
  wb.mergeCells(id, range);
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual([]);
  expect(wb.getValue(id, 1, 1)).toBe(5);
});

it('still merges the totals row, which is the table\'s footer, and cells beside the table', () => {
  const { wb, id } = book({ totals: true });
  wb.mergeCells(id, { r1: 2, c1: 0, r2: 3, c2: 0 });
  expect(wb.sheet(id).merges).toEqual([]);
  wb.mergeCells(id, { r1: 3, c1: 0, r2: 3, c2: 1 });
  wb.mergeCells(id, { r1: 4, c1: 0, r2: 4, c2: 2 });
  wb.mergeCells(id, { r1: 0, c1: 3, r2: 2, c2: 3 });
  expect(wb.sheet(id).merges).toEqual([{ r1: 3, c1: 0, r2: 3, c2: 1 }, { r1: 4, c1: 0, r2: 4, c2: 2 }, { r1: 0, c1: 3, r2: 2, c2: 3 }]);
});

it('does not make a table of a range holding merged cells until they are unmerged', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Header', null], [1, 2], [3, 4]]));
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual([]);
  wb.mergeCells(id, { r1: 1, c1: 0, r2: 2, c2: 0 });
  wb.unmergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' })).toBeNull();
  wb.unmergeCells(id, { r1: 1, c1: 0, r2: 2, c2: 0 });
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' })).toBeTruthy();
  expect(wb.tableColumns(id, wb.sheet(id).tables[0])).toEqual(['Header', 'Column2']);
});
