import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book(rows, range, name = 'T') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid(rows));
  const tid = wb.addTable(id, range, { name });
  return { wb, id, tid, columns: () => wb.tableColumns(id, wb.tableById(id, tid)) };
}

// Resizing a table over a column left its header as it was, so a repeated name made two columns one to a
// structured reference, a blank header took a default another column already had, and a formula header
// renamed the column whenever its inputs changed. Every other way a table gains a column normalises the header.
it('numbers a header that repeats a column name when the table is resized over it', () => {
  const { wb, id, tid, columns } = book([['Qty', 'Amt', 'Qty'], [1, 2, 30]], { r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, 4, 4, '=SUM(T[Qty])');
  wb.clearHistory();
  const before = new Workbook(wb.toJSON()).toJSON();
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 2 })).toBe(true);
  expect(columns()).toEqual(['Qty', 'Amt', 'Qty2']);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Qty2', f: null });
  expect(wb.getValue(id, 4, 4)).toBe(1);
  expect(wb.undoLabels()).toEqual(['Resize table']);
  wb.setInput(id, 5, 4, '=SUM(T[Qty2])');
  expect(wb.getValue(id, 5, 4)).toBe(30);
  wb.undo();
  wb.undo();
  // Loading normalises the table's optional calc map on both sides.
  expect(new Workbook(wb.toJSON()).toJSON()).toEqual(before);
});

it('gives a blank header the table grows over the first free ColumnN, leaving the columns their names', () => {
  const { wb, id, tid, columns } = book([[null, null, 'Qty'], ['left', 1, 2]], { r1: 0, c1: 1, r2: 1, c2: 2 });
  expect(columns()).toEqual(['Column1', 'Qty']);
  wb.setInput(id, 4, 4, '=SUM(T[Column1])');
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 2 })).toBe(true);
  expect(columns()).toEqual(['Column2', 'Column1', 'Qty']);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 'Column2', f: null });
  expect(wb.getValue(id, 4, 4)).toBe(1);
  // Two blank columns joining at once take the defaults in turn.
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 4 })).toBe(true);
  expect(columns()).toEqual(['Column2', 'Column1', 'Qty', 'Column4', 'Column5']);
});

it('turns a formula header the table grows over into the text it shows', () => {
  const { wb, id, tid, columns } = book([['Name', 'Qty', null], ['x', 5, null]], { r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, 0, 2, '=B2*2');
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 2 })).toBe(true);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: '10', f: null });
  expect(columns()).toEqual(['Name', 'Qty', '10']);
  wb.setInput(id, 1, 1, '7');
  expect(columns()).toEqual(['Name', 'Qty', '10']);
});

it('keeps a header an array formula spills into as the text it shows', () => {
  const { wb, id, tid, columns } = book([['Name', 'Qty', null, null], ['x', 5, null, null]], { r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, 0, 2, '={"Tax","Total"}');
  expect(wb.getValue(id, 0, 3)).toBe('Total');
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 2 })).toBe(true);
  expect(columns()).toEqual(['Name', 'Qty', 'Tax']);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Tax', f: null });
  expect(wb.getValue(id, 0, 3)).toBe('Total');
});

it('writes the name a blank header read as before the left edge moved, so references keep their column', () => {
  const { wb, id, tid, columns } = book([[null, 'Qty', null], [1, 2, 3]], { r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, 0, 0, '');
  expect(wb.getCell(id, 0, 0)?.v ?? null).toBeNull();
  expect(columns()).toEqual(['Column1', 'Qty']);
  wb.setInput(id, 4, 4, '=SUM(T[Column1])');
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 2 })).toBe(true);
  expect(columns()).toEqual(['Column1', 'Qty', 'Column3']);
  // Cutting the first column off and growing back to the right leaves the second where it was.
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 1, r2: 1, c2: 2 })).toBe(true);
  expect(columns()).toEqual(['Qty', 'Column3']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[Column1])');
  expect(wb.getValue(id, 4, 4)).toEqual({ error: '#REF!' });
});
