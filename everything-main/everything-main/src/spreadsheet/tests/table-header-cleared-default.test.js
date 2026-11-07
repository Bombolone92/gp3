import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A column whose header is literally "Column2" (a table created over blank headers writes such names) sits
// next to a column called Price; clearing Price would make it read as the default Column2 as well.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Column2', 'Price'], [1, 20]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'T' });
  wb.setInput(id, 5, 0, '=SUM(T[Column2])');
  wb.setInput(id, 6, 0, '=SUM(T[Price])');
  const columns = () => wb.tableColumns(id, wb.tableById(id, tid));
  return { wb, id, columns };
}

it('gives a cleared header whose default name another column uses the first free ColumnN, so references keep their column', () => {
  const { wb, id, columns } = book();
  wb.clearRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  expect(columns()).toEqual(['Column2', 'Column3']);
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Column3' });
  expect(wb.getCell(id, 5, 0).f).toBe('SUM(T[Column2])');
  expect(wb.getValue(id, 5, 0)).toBe(1);
  expect(wb.getCell(id, 6, 0).f).toBe('SUM(T[Column3])');
  expect(wb.getValue(id, 6, 0)).toBe(20);
  // Retyping the header renames only the column that was cleared.
  wb.setInput(id, 0, 1, 'Cost');
  expect(columns()).toEqual(['Column2', 'Cost']);
  expect(wb.getCell(id, 5, 0).f).toBe('SUM(T[Column2])');
  expect(wb.getCell(id, 6, 0).f).toBe('SUM(T[Cost])');
  expect(wb.getValue(id, 6, 0)).toBe(20);
  wb.undo();
  wb.undo();
  expect(columns()).toEqual(['Column2', 'Price']);
  expect(wb.getCell(id, 6, 0).f).toBe('SUM(T[Price])');
});

it('names a header emptied by typing the same way', () => {
  const { wb, id, columns } = book();
  wb.setInput(id, 0, 1, '');
  expect(columns()).toEqual(['Column2', 'Column3']);
  expect(wb.getCell(id, 6, 0).f).toBe('SUM(T[Column3])');
  expect(wb.getValue(id, 6, 0)).toBe(20);
});

it('leaves a cleared header blank when its default name is free', () => {
  const { wb, id, columns } = book();
  wb.clearRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 });
  expect(columns()).toEqual(['Column1', 'Price']);
  expect(wb.getCell(id, 0, 0)?.v ?? null).toBeNull();
  expect(wb.getCell(id, 5, 0).f).toBe('SUM(T[Column1])');
  expect(wb.getValue(id, 5, 0)).toBe(1);
});

it('keeps two headers cleared together distinct from each other and from the columns left alone', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Column2', 'Price', 'Qty'], [1, 20, 3]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 2 }, { name: 'T' });
  wb.setInput(id, 5, 0, '=SUM(T[Qty])');
  wb.clearRange(id, { r1: 0, c1: 1, r2: 0, c2: 2 });
  const columns = wb.tableColumns(id, wb.tableById(id, tid));
  expect(new Set(columns.map((n) => n.toLowerCase())).size).toBe(3);
  expect(columns[0]).toBe('Column2');
  expect(wb.getCell(id, 5, 0).f).toBe(`SUM(T[${columns[2]}])`);
  expect(wb.getValue(id, 5, 0)).toBe(3);
});
