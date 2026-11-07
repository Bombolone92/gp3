import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
function setup(tableName = null) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10'); wb.setInput(id, 0, 3, '99');
  const tableId = tableName ? wb.addTable(id, range, { name: tableName }) : null;
  return { wb, id, tableId };
}

it.each(['Sales', 'sales', ' SALES '])('rejects a defined name %s that would shadow a table', (name) => {
  const { wb, id } = setup('Sales');
  wb.setInput(id, 0, 5, '=SUM(INDIRECT("Sales"))');
  expect(wb.getValue(id, 0, 5)).toBe(10);
  wb.clearHistory();
  expect(wb.defineName(name, 'Sheet1!D1')).toBe('That name is already used');
  expect(wb.getValue(id, 0, 5)).toBe(10);
  expect(wb.names).toHaveLength(0);
  expect(wb.canUndo()).toBe(false);
});

it('chooses a free table name when an explicit name is already defined', () => {
  const { wb, id } = setup();
  wb.defineName('sales', 'Sheet1!D1');
  const tableId = wb.addTable(id, range, { name: 'Sales' });
  expect(wb.tableById(id, tableId).name).not.toMatch(/^sales$/i);
  wb.setInput(id, 0, 5, '=INDIRECT("Sales")');
  expect(wb.getValue(id, 0, 5)).toBe(99);
});

it('skips defined names when generating default table names', () => {
  const { wb, id } = setup();
  wb.defineName('Table1', 'Sheet1!D1'); wb.defineName('table2', '=42');
  expect(wb.uniqueTableName()).toBe('Table3');
  const tid = wb.addTable(id, range);
  expect(wb.tableById(id, tid).name).toBe('Table3');
});

it('refuses a colliding table rename atomically, then permits a unique rename and undo', () => {
  const { wb, id, tableId } = setup('Orders');
  wb.defineName('Sales', 'Sheet1!D1');
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.updateTable(id, tableId, { name: 'sales', banded: false, totalsRow: true })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(wb.updateTable(id, tableId, { name: 'orders' })).toBe(true);
  expect(wb.updateTable(id, tableId, { name: 'NewOrders' })).toBe(true);
  wb.undo();
  expect(wb.tableById(id, tableId).name).toBe('orders');
});

it('avoids defined names when duplicating tables and rewrites copied references', () => {
  const { wb, id } = setup('Sales');
  wb.defineName('Sales2', 'Sheet1!D1');
  wb.setInput(id, 0, 5, '=SUM(Sales[Value])');
  const copy = wb.duplicateSheet(id);
  expect(copy.tables[0].name).toBe('Sales3');
  expect(wb.getCell(copy.id, 0, 5).f).toBe('SUM(Sales3[Value])');
  expect(wb.getValue(copy.id, 0, 5)).toBe(10);
});

it('reserves existing and incoming defined names while importing tables', () => {
  const { wb, id } = setup();
  wb.defineName('Sales', 'Sheet1!D1');
  const { wb: source, id: sourceId } = setup('Sales');
  source.defineName('Sales2', 'Sheet1!D1');
  source.setInput(sourceId, 0, 5, '=SUM(Sales[Value])+Sales2');
  const [added] = wb.importSheets(source);
  expect(added.tables[0].name).toBe('Sales3');
  expect(wb.getValue(added.id, 0, 5)).toBe(109);
  expect(wb.namedRef('Sales').sheet).toBe(wb.sheet(id).name);
});

it('avoids defined names when replacing a sheet with imported tables', () => {
  const { wb, id } = setup();
  wb.defineName('Sales', 'Sheet1!D1');
  const { wb: source, id: sourceId } = setup('Sales');
  source.setInput(sourceId, 0, 5, '=SUM(Sales[Value])');
  const replaced = wb.replaceSheetWith(id, source, sourceId);
  expect(replaced.tables[0].name).toBe('Sales2');
  expect(wb.getValue(id, 0, 5)).toBe(10);
});

it('preserves pre-existing colliding names when loading legacy workbooks', () => {
  const { wb } = setup('Sales');
  const json = wb.toJSON();
  json.names = [{ name: 'Sales', ref: 'Sheet1!D1' }];
  const loaded = new Workbook(json);
  expect(loaded.names).toEqual(json.names);
  expect(loaded.tableNames()).toEqual(['Sales']);
  loaded.addSheet('Extra');
  loaded.undo();
  expect(loaded.names).toEqual(json.names);
});
