import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Blank entries are left out so an array formula already spilled over them is kept.
const grid = (rows, r0 = 0) => rows.flatMap((row, r) => row.flatMap((v, c) => (v == null ? [] : [{ r: r + r0, c, cell: { v } }])));

it('keeps every header of a spilled header row as text when a table is made over it', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '={"Name","Qty"}');
  wb.setCells(id, grid([['a', 1]], 1));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'T' });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Name', 'Qty']);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 'Name', f: null });
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Qty', f: null });
  wb.setInput(id, 4, 4, '=SUM(T[Qty])');
  expect(wb.getValue(id, 4, 4)).toBe(1);
  wb.undo();
  wb.undo();
  expect(wb.sheet(id).tables).toEqual([]);
  expect(wb.getCell(id, 0, 0).f).toBe('{"Name","Qty"}');
  expect(wb.getDisplay(id, 0, 1)).toBe('Qty');
});

it('keeps the part of the spill outside the table as values instead of losing it with the formula', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '={"Name","Qty","Tag"}');
  wb.setCells(id, grid([['a', 1]], 1));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'T' });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Name', 'Qty']);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Tag', f: null });
});

it('numbers a spilled header that repeats another column, as a typed duplicate is', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '={"Name","Qty"}');
  wb.setCells(id, grid([['Name', null, null], ['x', 'a', 1]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 2 }, { name: 'T' });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Name', 'Name2', 'Qty']);
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Name2', f: null });
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Qty', f: null });
});

it('refuses the table atomically when the spill filling its header row is protected', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 2, '={"Name","Qty"}');
  wb.setCells(id, grid([['a', 1]], 1));
  wb.protectRange(id, { r1: 0, c1: 2, r2: 0, c2: 3 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 3 }, { name: 'T' })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('keeps a spilled header the table grows over by typing beside it', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 2, '={"x";"Tag"}');
  wb.setCells(id, grid([['Name', 'Qty'], ['a', 1]], 1));
  const tid = wb.addTable(id, { r1: 1, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
  expect(wb.getDisplay(id, 1, 2)).toBe('Tag');
  wb.setInput(id, 2, 2, '5');
  expect(wb.tableById(id, tid).range).toEqual({ r1: 1, c1: 0, r2: 2, c2: 2 });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Name', 'Qty', 'Tag']);
  expect(wb.getCell(id, 1, 2)).toMatchObject({ v: 'Tag', f: null });
  expect(wb.getValue(id, 0, 2)).toBe('x');
});
