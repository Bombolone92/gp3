import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { findAll, replaceCells } from '../src/core/search.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['A', 'AA', 'Total'], [2, 3, null], [4, 5, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tableId = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'Sales' });
  wb.setInput(id, 1, 2, '=[@A]+[@AA]');
  const otherId = wb.addSheet('Summary').id;
  wb.setInput(otherId, 0, 0, '=SUM(Sales[A])');
  wb.setInput(otherId, 1, 0, '=SUM(Sales[AA])');
  wb.clearHistory();
  return { wb, id, otherId, tableId };
}

it('renames replaced table headers simultaneously and keeps dependent formulas and templates live', () => {
  const { wb, id, otherId, tableId } = setup();
  const opts = { formulas: false, range: { r1: 0, c1: 0, r2: 0, c2: 1 } };
  const before = wb.toJSON();
  expect(replaceCells(wb, id, findAll(wb, id, 'A', opts), 'A', 'AA', opts)).toBe(2);
  expect(wb.tableColumns(id, wb.tableById(id, tableId))).toEqual(['AA', 'AAAA', 'Total']);
  expect(wb.getValue(otherId, 0, 0)).toBe(6);
  expect(wb.getValue(otherId, 1, 0)).toBe(8);
  expect(wb.getCell(otherId, 0, 0).f).toBe('SUM(Sales[AA])');
  expect(wb.getCell(otherId, 1, 0).f).toBe('SUM(Sales[AAAA])');
  expect(wb.getValue(id, 1, 2)).toBe(5);
  expect(wb.getValue(id, 2, 2)).toBe(9);
  expect(wb.tableById(id, tableId).calc['2']).toBe('[@AA]+[@AAAA]');
  expect(wb.undoLabels()).toEqual(['Replace']);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  wb.setInput(id, 3, 0, '10');
  wb.setInput(id, 3, 1, '20');
  expect(wb.getValue(id, 3, 2)).toBe(30);
  expect(wb.getValue(otherId, 0, 0)).toBe(16);
});

it('leaves a protected header alone, renaming the others and the references to them', () => {
  const { wb, id, otherId, tableId } = setup();
  wb.protectRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  const opts = { formulas: false };
  expect(replaceCells(wb, id, findAll(wb, id, 'A', opts), 'A', 'AA', opts)).toBe(2);
  // The renamed first column cannot take the protected header's name, so it is made unique.
  expect(wb.tableColumns(id, wb.tableById(id, tableId))).toEqual(['AA2', 'AA', 'TotAAl']);
  expect(wb.getCell(otherId, 0, 0).f).toBe('SUM(Sales[AA2])');
  expect(wb.getValue(otherId, 0, 0)).toBe(6);
  expect(wb.getCell(otherId, 1, 0).f).toBe('SUM(Sales[AA])');
  expect(wb.getValue(otherId, 1, 0)).toBe(8);
  expect(wb.getValue(id, 1, 2)).toBe(5);
});

it('does not rewrite formula references a second time when they were explicitly replaced', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Price', 'PricePrice', 'Total'], [2, 3, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 2 }, { name: 'Sales' });
  wb.setInput(id, 1, 2, '=[@Price]+[@PricePrice]');
  wb.setInput(id, 0, 4, '=SUM(Sales[Price])');
  wb.clearHistory();
  const before = wb.toJSON();
  expect(replaceCells(wb, id, findAll(wb, id, 'Price'), 'Price', 'PricePrice')).toBe(4);
  expect(wb.getCell(id, 0, 4).f).toBe('SUM(Sales[PricePrice])');
  expect(wb.getValue(id, 0, 4)).toBe(2);
  expect(wb.getValue(id, 1, 2)).toBe(5);
  expect(wb.tableById(id, tid).calc['2']).toBe('[@PricePrice]+[@PricePricePricePrice]');
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
});
