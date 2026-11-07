import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Trim whitespace, Change case, Convert to numbers and Text to columns wrote straight to the
// cells, so over a table's header row they renamed columns without rewriting the structured
// references that used the old names (formulas went #REF! or quietly read another column), let
// two columns share a name, and turned a header back into a number. They now write the way
// typing, pasting and filling a header do: names stay distinct, references follow, headers stay text.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Unit  Price', 'Unit Price', 2024], [1, 2, 3], [4, 5, 6]]));
  const tid = wb.addTable(id, parseRange('A1:C3'), { name: 'T' });
  wb.setInput(id, 0, 4, '=SUM(T[Unit  Price])');
  wb.setInput(id, 1, 4, '=SUM(T[Unit Price])');
  wb.setInput(id, 2, 4, '=SUM(T[2024])');
  expect([wb.getValue(id, 0, 4), wb.getValue(id, 1, 4), wb.getValue(id, 2, 4)]).toEqual([5, 7, 9]);
  const columns = () => wb.tableColumns(id, wb.tableById(id, tid));
  return { wb, id, tid, columns };
}

it('keeps column names distinct and rewrites references when Trim whitespace renames a header', () => {
  const { wb, id, columns } = book();
  expect(wb.transformText(id, parseRange('A1:C1'), 'trim')).toBe(1);
  expect(columns()).toEqual(['Unit Price2', 'Unit Price', '2024']);
  expect(wb.getCell(id, 0, 4).f).toBe('SUM(T[[Unit Price2]])');
  expect(wb.getCell(id, 1, 4).f).toBe('SUM(T[Unit Price])');
  expect([wb.getValue(id, 0, 4), wb.getValue(id, 1, 4)]).toEqual([5, 7]);
  wb.undo();
  expect(columns()).toEqual(['Unit  Price', 'Unit Price', '2024']);
  expect(wb.getCell(id, 0, 4).f).toBe('SUM(T[Unit  Price])');
});

it('follows a header through Change case', () => {
  const { wb, id, columns } = book();
  expect(wb.transformText(id, parseRange('A1:C3'), 'upper')).toBe(2);
  expect(columns()).toEqual(['UNIT  PRICE', 'UNIT PRICE', '2024']);
  expect(wb.getCell(id, 0, 4).f).toBe('SUM(T[[UNIT  PRICE]])');
  expect([wb.getValue(id, 0, 4), wb.getValue(id, 1, 4)]).toEqual([5, 7]);
});

it('leaves a table header as text when converting a range to numbers', () => {
  const { wb, id, columns } = book();
  wb.setCells(id, [{ r: 1, c: 2, cell: { v: '3' } }, { r: 3, c: 4, cell: { v: '12' } }]);
  expect(wb.transformText(id, parseRange('A1:E4'), 'number')).toBe(2);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: '2024' });
  expect(wb.getValue(id, 1, 2)).toBe(3);
  expect(wb.getValue(id, 3, 4)).toBe(12);
  expect(columns()).toEqual(['Unit  Price', 'Unit Price', '2024']);
  expect(wb.getValue(id, 2, 4)).toBe(9);
  // A header row alone holds nothing to convert.
  expect(wb.transformText(id, parseRange('A1:C1'), 'number')).toBe(0);
});

it('renames the columns Text to columns writes over and rewrites references to them', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['First Last', 'Qty'], ['a b', 2], ['c d', 3]]));
  const tid = wb.addTable(id, parseRange('A1:B3'), { name: 'T' });
  wb.setInput(id, 0, 3, '=SUM(T[Qty])');
  expect(wb.splitTextToColumns(id, parseRange('A1:A1'), ' ')).toEqual({ rows: 1, cols: 2 });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['First', 'Last']);
  expect(wb.getCell(id, 0, 3).f).toBe('SUM(T[Last])');
  expect(wb.getValue(id, 0, 3)).toBe(5);
  wb.undo();
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['First Last', 'Qty']);
  expect(wb.getCell(id, 0, 3).f).toBe('SUM(T[Qty])');
});
