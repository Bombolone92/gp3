import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function make(headers, inputs = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([headers, headers.map((_, c) => c + 1)]));
  for (const [c, text] of Object.entries(inputs)) wb.setInput(id, 0, Number(c), text);
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: headers.length - 1 }, { name: 'T' });
  return { wb, id, tid, columns: () => wb.tableColumns(id, wb.tableById(id, tid)) };
}

it('keeps the text of a formula header instead of replacing it with ColumnN', () => {
  const { wb, id, columns } = make(['Name', null, 'Qty'], { 1: '="Total "&"Sales"' });
  expect(columns()).toEqual(['Name', 'Total Sales', 'Qty']);
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Total Sales', f: null });
  wb.setInput(id, 4, 4, '=SUM(T[Total Sales])');
  expect(wb.getValue(id, 4, 4)).toBe(2);
});

it('numbers a header that repeats another, ignoring case, the way later renames do', () => {
  const { wb, id, columns } = make(['Name', 'name', 'Qty']);
  expect(columns()).toEqual(['Name', 'name2', 'Qty']);
  expect(wb.getCell(id, 0, 1).v).toBe('name2');
  expect(wb.getCell(id, 0, 0).v).toBe('Name');
  wb.setInput(id, 4, 4, '=SUM(T[name2])');
  expect(wb.getValue(id, 4, 4)).toBe(2);
});

it('skips numbered and default names that other headers of the range already use', () => {
  const { columns } = make(['Name', 'name', 'Name2', null, 'Column5']);
  expect(columns()).toEqual(['Name', 'name3', 'Name2', 'Column4', 'Column5']);
  const blanks = make([null, 'Column1']);
  expect(blanks.columns()).toEqual(['Column2', 'Column1']);
});

it('turns a formula typed into an existing header into the text it shows, so the column name does not follow its inputs', () => {
  const { wb, id, columns } = make(['Name', 'Qty']);
  wb.setInput(id, 0, 3, 'Label');
  wb.setInput(id, 4, 4, '=SUM(T[Qty])');
  wb.setInput(id, 0, 1, '=D1');
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Label', f: null });
  expect(columns()).toEqual(['Name', 'Label']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[Label])');
  expect(wb.getValue(id, 4, 4)).toBe(2);
  wb.setInput(id, 0, 3, 'Other');
  expect(columns()).toEqual(['Name', 'Label']);
  expect(wb.getValue(id, 4, 4)).toBe(2);
  // A formula that shows another column's name is numbered like a typed duplicate.
  wb.setInput(id, 0, 1, '="Name"');
  expect(columns()).toEqual(['Name', 'Name2']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[Name2])');
  wb.undo();
  expect(columns()).toEqual(['Name', 'Label']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[Label])');
});

it('undoes the header fixes with the table', () => {
  const { wb, id, columns } = make(['Name', 'name', null], { 2: '=1+1' });
  expect(columns()).toEqual(['Name', 'name2', '2']);
  wb.undo();
  expect(wb.sheet(id).tables).toEqual([]);
  expect(wb.getCell(id, 0, 1).v).toBe('name');
  expect(wb.getCell(id, 0, 2).f).toBe('1+1');
});
