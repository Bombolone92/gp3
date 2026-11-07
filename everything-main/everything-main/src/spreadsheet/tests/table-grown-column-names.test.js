import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid(rows));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: rows.length - 1, c2: rows[0].length - 1 }, { name: 'T' });
  const columns = () => wb.tableColumns(id, wb.tableById(id, tid));
  return { wb, id, tid, columns };
}

it('names a column grown by typing beside the table after the first free ColumnN', () => {
  const { wb, id, columns } = book([['A', 'Column3'], [1, 2]]);
  wb.setInput(id, 1, 2, '7');
  expect(columns()).toEqual(['A', 'Column3', 'Column4']);
  expect(wb.getValue(id, 0, 2)).toBe('Column4');
  wb.setInput(id, 5, 5, '=SUM(T[Column4])');
  expect(wb.getValue(id, 5, 5)).toBe(7);
});

it('numbers a header typed beside the table that repeats an existing column name', () => {
  const { wb, id, columns } = book([['Name', 'Qty'], ['x', 2]]);
  wb.setInput(id, 0, 2, 'Name');
  expect(columns()).toEqual(['Name', 'Qty', 'Name2']);
  expect(wb.getValue(id, 0, 2)).toBe('Name2');
  wb.undo();
  expect(wb.tableById(id, wb.sheet(id).tables[0]?.id)?.range.c2 ?? 1).toBe(1);
  expect(wb.getValue(id, 0, 2)).toBeNull();
});

it('renames an existing header cell that the table grows over when it repeats a column name', () => {
  const { wb, id, columns } = book([['Name', 'Qty'], ['x', 2]]);
  wb.setInput(id, 0, 2, 'qty');
  expect(columns()).toEqual(['Name', 'Qty', 'qty2']);
});

it('gives columns inserted inside a table their own names', () => {
  const { wb, id, columns } = book([['A', 'Column2', 'B'], [1, 2, 3]]);
  wb.setInput(id, 5, 5, '=SUM(T[Column2])');
  wb.insertCols(id, 1, 2);
  expect(columns()).toEqual(['A', 'Column3', 'Column4', 'Column2', 'B']);
  expect(wb.getValue(id, 0, 1)).toBe('Column3');
  expect(wb.getValue(id, 0, 2)).toBe('Column4');
  expect(wb.getValue(id, 5, 7)).toBe(2);
  wb.undo();
  expect(columns()).toEqual(['A', 'Column2', 'B']);
  expect(wb.getCell(id, 0, 1)?.v).toBe('Column2');
});

it('leaves headers alone when columns are inserted outside the table', () => {
  const { wb, id, columns } = book([['A', 'Column2'], [1, 2]]);
  wb.insertCols(id, 2, 1);
  expect(columns()).toEqual(['A', 'Column2']);
  expect(wb.getCell(id, 0, 2)).toBeUndefined();
  wb.insertCols(id, 0, 1);
  expect(columns()).toEqual(['A', 'Column2']);
  expect(wb.getCell(id, 0, 0)).toBeUndefined();
});
