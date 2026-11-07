import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { setLocale } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

// A number or date typed as a header stayed a number, so the column was named by its display: a regional
// format that writes 1,5 for 1.5 or 15.01.2024 for a date renamed the column and broke every reference to
// it, and INDEX(Table[#Headers], ...) answered a serial instead of the text.
it('turns numeric and date headers into the text they show when the table is made', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [c, text] of [[0, '1.5'], [1, 'Qty'], [2, 'Jan 15, 2024'], [3, '2024']]) wb.setInput(id, 0, c, text);
  for (const [c, text] of [[0, '7'], [1, '2'], [2, '3'], [3, '1']]) wb.setInput(id, 1, c, text);
  expect(typeof wb.getValue(id, 0, 0)).toBe('number');
  expect(typeof wb.getValue(id, 0, 2)).toBe('number');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 3 }, { name: 'T' });
  const columns = () => wb.tableColumns(id, wb.tableById(id, tid));
  expect(columns()).toEqual(['1.5', 'Qty', 'Jan 15, 2024', '2024']);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: '1.5', f: null });
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Jan 15, 2024', f: null });
  expect(wb.getCell(id, 0, 3)).toMatchObject({ v: '2024', f: null });
  wb.setInput(id, 3, 0, '=SUM(T[[1.5]])');
  wb.setInput(id, 3, 1, '=ISTEXT(INDEX(T[#Headers],1,4))');
  wb.setInput(id, 3, 2, '=SUM(T[#All])');
  wb.setInput(id, 3, 3, '=INDEX(T[#Headers],1,3)');
  expect(wb.getValue(id, 3, 0)).toBe(7);
  expect(wb.getValue(id, 3, 1)).toBe(true);
  expect(wb.getValue(id, 3, 2)).toBe(13);
  expect(wb.getValue(id, 3, 3)).toBe('Jan 15, 2024');
  setLocale('de-DE');
  wb._invalidate();
  expect(columns()).toEqual(['1.5', 'Qty', 'Jan 15, 2024', '2024']);
  expect(wb.getValue(id, 3, 0)).toBe(7);
  wb.undo();
  expect(wb.getValue(id, 3, 0)).toBe(7);
});

it('stores a number typed into a header, or grown over, as the text it shows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Qty', null], ['x', 5, null]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'T' });
  const columns = () => wb.tableColumns(id, wb.tableById(id, tid));
  wb.setInput(id, 4, 4, '=SUM(T[Qty])');
  wb.setInput(id, 0, 1, '2024-01-15');
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: '2024-01-15', f: null });
  expect(columns()).toEqual(['Name', '2024-01-15']);
  expect(wb.getCell(id, 4, 4).f).toBe('SUM(T[[2024-01-15]])');
  expect(wb.getValue(id, 4, 4)).toBe(5);
  wb.setCells(id, [{ r: 0, c: 2, cell: { v: 12.5, f: null, s: { fmt: 'percent', dec: 1 } } }]);
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 1, c2: 2 })).toBe(true);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: '1,250.0%', f: null });
  expect(columns()).toEqual(['Name', '2024-01-15', '1,250.0%']);
});

it('turns the numbers of a row promoted to a table\'s header into text', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Qty'], [2024, 1.5], ['y', 7]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
  wb.setInput(id, 5, 5, '=SUM(T[Qty])');
  wb.deleteRows(id, 0, 1);
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['2024', '1.5']);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: '2024', f: null });
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: '1.5', f: null });
  expect(wb.getCell(id, 4, 5).f).toBe('SUM(T[[1.5]])');
  expect(wb.getValue(id, 4, 5)).toBe(7);
});
