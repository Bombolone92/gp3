import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { renameTableInFormula, tableRefsToA1 } from '../src/core/tables.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const renameCases = [
  ['SUM(Sales)+SUM(Sales[Value])', 'SUM(Orders)+SUM(Orders[Value])'],
  ['SUM(sales)+"Sales"+SalesTax', 'SUM(Orders)+"Sales"+SalesTax'],
  ['LET(Sales,7,Sales+SUM(Sales[Value]))', 'LET(Sales,7,Sales+SUM(Orders[Value]))'],
  ['LET(Sales,Sales,SUM(Sales))', 'LET(Sales,Orders,SUM(Sales))'],
  ['LAMBDA(Sales,SUM(Sales))(Sales)', 'LAMBDA(Sales,SUM(Sales))(Orders)'],
  ['LAMBDA([Sales],IF(ISOMITTED(Sales),0,SUM(Sales)))(Sales)', 'LAMBDA([Sales],IF(ISOMITTED(Sales),0,SUM(Sales)))(Orders)'],
  ['LET(fn,LAMBDA(SUM(Sales)),Sales,7,fn())', 'LET(fn,LAMBDA(SUM(Sales)),Sales,7,fn())'],
  ['LET(fn,LET(x,1,LAMBDA(SUM(Sales))),Sales,7,fn())', 'LET(fn,LET(x,1,LAMBDA(SUM(Orders))),Sales,7,fn())'],
  ['LET(x,1,LAMBDA(SUM(Sales)))', 'LET(x,1,LAMBDA(SUM(Orders)))'],
  ['SUM((Sales,A1))+ISOMITTED(Sales)', 'SUM((Orders,A1))+ISOMITTED(Sales)'],
  ['=LET(x,Sales,SUM(x))', '=LET(x,Orders,SUM(x))'],
  ['LET(Orders,7,SUM(Sales))', 'LET(Orders,7,SUM(Orders[#Data]))'],
  ['SUM(LET(x,LAMBDA(Sales)(),Sales,7,x))', 'SUM(LET(x,LAMBDA(Orders)(),Sales,7,x))'],
];
it.each(renameCases)('rewrites table references without changing local names in %s', (input, expected) => {
  expect(renameTableInFormula(input, 'Sales', 'Orders')).toBe(expected);
});

it('keeps built-in calls intact when a table shares their spelling', () => {
  expect(renameTableInFormula('SUM(SUM)+SUM(1,2)', 'SUM', 'Data')).toBe('SUM(Data)+SUM(1,2)');
});

it.each([
  ['LET(Orders,7,SUM(Sales))', 30],
  ['LET(fn,LAMBDA(SUM(Sales)),Sales,7,fn())', 7],
  ['LET(fn,LET(x,1,LAMBDA(SUM(Sales))),Sales,7,fn())', 30],
  ['SUM(LET(x,LAMBDA(Sales)(),Sales,7,x))', 30],
])('preserves evaluated scope behavior during rename: %s', (formula, expected) => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 0, 3, `=${formula}`);
  expect(wb.getValue(id, 0, 3)).toBe(expected);
  wb.updateTable(id, tid, { name: 'Orders' });
  expect(wb.getValue(id, 0, 3)).toBe(expected);
});

it('rewrites calculated-column templates so new rows keep reading the renamed table', () => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 0, 5, 'Total');
  const summary = wb.addTable(id, { r1: 0, c1: 5, r2: 2, c2: 5 }, { name: 'Summary' });
  wb.setInput(id, 1, 5, '=SUM(Sales)');
  wb.updateTable(id, tid, { name: 'Orders' });
  expect(wb.addTableRow(id, summary)).toBe(3);
  expect(wb.getCell(id, 3, 5).f).toBe('SUM(Orders)');
  expect(wb.getValue(id, 3, 5)).toBe(30);
});

it.each(['rename', 'convert'])('updates named expressions and lambdas during %s', (action) => {
  const { wb, id, tid } = setup();
  const other = wb.addSheet('Summary').id;
  wb.defineName('TotalSales', '=SUM(Sales)');
  wb.defineName('GetSales', '=LAMBDA(SUM(Sales))');
  wb.setInput(other, 0, 0, '=TotalSales+GetSales()');
  if (action === 'rename') wb.updateTable(id, tid, { name: 'Orders' });
  else wb.deleteTable(id, tid);
  expect(wb.getValue(other, 0, 0)).toBe(60);
  wb.undo();
  expect(wb.getValue(other, 0, 0)).toBe(60);
});

it('updates incoming named formulas when imported tables are renamed', () => {
  const { wb } = setup(), source = setup();
  source.wb.defineName('ImportedTotal', '=SUM(Sales)');
  const [added] = wb.importSheets(source.wb);
  wb.setInput(added.id, 1, 0, '40');
  wb.setInput(added.id, 1, 3, '=ImportedTotal');
  expect(wb.getValue(added.id, 1, 3)).toBe(60);
});

it('leaves a legacy defined name intact when a colliding table is renamed', () => {
  const { wb, id, tid } = setup();
  const json = wb.toJSON();
  json.names = [{ name: 'Sales', ref: '7' }];
  const loaded = new Workbook(json);
  loaded.updateTable(id, tid, { name: 'Orders' });
  expect(loaded.getCell(id, 0, 3).f).toBe('SUM(Sales)');
  expect(loaded.getValue(id, 0, 3)).toBe(7);
});

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10'); wb.setInput(id, 2, 0, '20');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Sales' });
  wb.setInput(id, 0, 3, '=SUM(Sales)');
  return { wb, id, tid };
}

it.each(['rename', 'convert'])('keeps formulas live through table %s and undo', (action) => {
  const { wb, id, tid } = setup();
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=SUM(Sales)');
  if (action === 'rename') wb.updateTable(id, tid, { name: 'Orders' });
  else wb.deleteTable(id, tid);
  expect(wb.getValue(id, 0, 3)).toBe(30);
  expect(wb.getValue(other, 0, 0)).toBe(30);
  expect(wb.getCell(id, 0, 3).f).toBe(action === 'rename' ? 'SUM(Orders)' : 'SUM($A$2:$A$3)');
  expect(wb.getCell(other, 0, 0).f).toBe(action === 'rename' ? 'SUM(Orders)' : 'SUM(Sheet1!$A$2:$A$3)');
  wb.undo();
  expect(wb.getCell(id, 0, 3).f).toBe('SUM(Sales)');
  expect(wb.getValue(other, 0, 0)).toBe(30);
});

it('rewrites only known global table names when converting to A1 references', () => {
  const resolve = (name) => name === 'SALES' ? { r1: 1, c1: 0, r2: 2, c2: 0 } : null;
  expect(tableRefsToA1('SUM(Sales)+Tax+LET(Sales,7,Sales)', resolve, null, ['Sales']))
    .toBe('SUM($A$2:$A$3)+Tax+LET(Sales,7,Sales)');
});

it.each(['duplicate', 'import'])('keeps bare references attached to tables during %s', (action) => {
  const { wb, id } = setup();
  const source = setup();
  const added = action === 'duplicate' ? wb.duplicateSheet(id) : wb.importSheets(source.wb)[0];
  expect(wb.getCell(added.id, 0, 3).f).toBe('SUM(Sales2)');
  wb.setInput(added.id, 1, 0, '40');
  expect(wb.getValue(added.id, 0, 3)).toBe(60);
  expect(wb.getValue(id, 0, 3)).toBe(30);
});

it('preserves bare table references in native XLSX and on reopening', async () => {
  const { wb, id } = setup();
  const bytes = await workbookToXlsx(wb);
  const file = X.read(await bytes.arrayBuffer(), { type: 'array' });
  expect(file.Sheets.Sheet1.D1.f).toBe('SUM(Sales)');
  const reopened = await workbookFromFile(bytes, 'bare-table.xlsx');
  expect(reopened.getCell(reopened.sheets[0].id, 0, 3).f).toBe('SUM(Sales)');
  expect(reopened.getValue(reopened.sheets[0].id, 0, 3)).toBe(30);
});
