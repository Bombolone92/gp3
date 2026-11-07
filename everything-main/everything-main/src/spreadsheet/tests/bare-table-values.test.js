import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup(name = 'Sales') {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Price'], [2, 10], [3, 20]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name });
  const calc = (formula) => { wb.setInput(id, 9, 9, `=${formula}`); return wb.getValue(id, 9, 9); };
  return { wb, id, tid, calc };
}

it.each(['Sales', 'sales', 'SALES'])('resolves bare %s to table data with its address', (name) => {
  const { calc } = setup();
  expect(calc(`SUM(${name})`)).toBe(35);
  expect(calc(`ROWS(${name})`)).toBe(2);
  expect(calc(`COLUMNS(${name})`)).toBe(2);
  expect(calc(`ISREF(${name})`)).toBe(true);
  expect(calc(`ROW(INDEX(${name},2,2))`)).toBe(3);
  expect(calc(`COLUMN(INDEX(${name},2,2))`)).toBe(2);
});

it('excludes headers and totals and follows table growth and undo', () => {
  const { wb, id, tid, calc } = setup();
  wb.setTableTotals(id, tid, true);
  expect(calc('SUM(Sales)')).toBe(35);
  wb.setTableTotals(id, tid, false);
  wb.transaction('Grow table', () => {
    wb.setInput(id, 3, 0, '4'); wb.setInput(id, 3, 1, '30');
    wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 3, c2: 1 });
  });
  expect(wb.getValue(id, 9, 9)).toBe(69);
  wb.undo();
  expect(wb.getValue(id, 9, 9)).toBe(35);
});

it.each(['Sales', 'SUM', 'PI', 'LET'])('discovers spills from bare table %s before reading its anchor', (name) => {
  const { wb, id } = setup(name);
  wb.setInput(id, 9, 9, `=${name}`);
  expect(wb.getValue(id, 10, 10)).toBe(20);
  expect(wb.getValue(id, 9, 9)).toBe(2);
});

it('discovers a new table even when a bare built-in formula was already cached', () => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 9, 9, '=PI');
  expect(wb.getValue(id, 9, 9)).toBe(Math.PI);
  wb.updateTable(id, tid, { name: 'PI' });
  expect(wb.getValue(id, 10, 10)).toBe(20);
  wb.undo();
  expect(wb.getValue(id, 9, 9)).toBe(Math.PI);
  expect(wb.getValue(id, 10, 10)).toBeNull();
});

it('retains local bindings, native function calls, and unknown-name errors', () => {
  const { calc } = setup('SUM');
  expect(calc('SUM(SUM)')).toBe(35);
  expect(calc('SUM(1,2)')).toBe(3);
  expect(calc('LET(SUM,7,SUM+1)')).toBe(8);
  expect(calc('LAMBDA(SUM,SUM+1)(7)')).toBe(8);
  expect(calc('MissingTable')).toEqual({ error: '#NAME?' });
});

it('retains reference composition and cross-sheet values', () => {
  const { wb, id } = setup();
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=SUM(OFFSET(Sales,0,1,2,1))');
  expect(wb.getValue(other, 0, 0)).toBe(30);
  wb.setInput(id, 2, 1, '40');
  expect(wb.getValue(other, 0, 0)).toBe(50);
});

it('retains existing defined-name precedence in legacy colliding files', () => {
  const { wb } = setup();
  const json = wb.toJSON();
  json.names = [{ name: 'Sales', ref: '99' }];
  const loaded = new Workbook(json), id = loaded.activeSheetId;
  loaded.setInput(id, 9, 9, '=Sales');
  expect(loaded.getValue(id, 9, 9)).toBe(99);
});

it('reopens XLSX formulas using bare table names', async () => {
  let { wb, id, calc } = setup();
  expect(calc('SUM(Sales)')).toBe(35);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'bare-table.xlsx');
  expect(wb.getValue(wb.sheets[0].id, 9, 9)).toBe(35);
});
