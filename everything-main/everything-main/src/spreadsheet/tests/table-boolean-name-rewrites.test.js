import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { renameTableInFormula } from '../src/core/tables.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value');
  wb.setInput(id, 1, 0, '10');
  wb.setInput(id, 2, 0, '20');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Sales' });
  wb.setInput(id, 0, 3, '=SUM(Sales)+IF(TRUE,1,100)+IF(FALSE,100,2)');
  return { wb, id, tid };
}

it.each(['TRUE', 'FALSE', 'True', 'false'])('retains table identity when renamed to %s', (name) => {
  const { wb, id, tid } = setup();
  wb.defineName('TotalSales', '=SUM(Sales)');
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=SUM(Sales)+TotalSales');
  expect(wb.getValue(id, 0, 3)).toBe(33);
  wb.updateTable(id, tid, { name });
  expect(wb.getValue(id, 0, 3)).toBe(33);
  expect(wb.getValue(other, 0, 0)).toBe(60);
  expect(wb.getCell(id, 0, 3).f).toBe(`SUM(${name}[#Data])+IF(TRUE,1,100)+IF(FALSE,100,2)`);
  wb.setInput(id, 1, 0, '40');
  expect(wb.getValue(id, 0, 3)).toBe(63);
  wb.undo();
  wb.undo();
  expect(wb.tableById(id, tid).name).toBe('Sales');
  expect(wb.getValue(other, 0, 0)).toBe(60);
  wb.redo();
  expect(wb.getValue(other, 0, 0)).toBe(60);
});

it.each(['TRUE', 'FALSE'])('preserves references through rename to %s and back', (name) => {
  const formula = 'SUM(Sales)+SUM(Sales[Value])+IF(TRUE,1,FALSE)';
  const renamed = renameTableInFormula(formula, 'Sales', name);
  expect(renamed).toBe(`SUM(${name}[#Data])+SUM(${name}[Value])+IF(TRUE,1,FALSE)`);
  expect(renameTableInFormula(renamed, name, 'Orders'))
    .toBe('SUM(Orders[#Data])+SUM(Orders[Value])+IF(TRUE,1,FALSE)');
});

it.each(['TRUE', 'FALSE'])('keeps renamed table %s references live after XLSX reopening and conversion', async (name) => {
  const { wb, id, tid } = setup();
  wb.updateTable(id, tid, { name });
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'boolean-table.xlsx');
  const sheet = reopened.activeSheet;
  expect(reopened.getValue(sheet.id, 0, 3)).toBe(33);
  reopened.deleteTable(sheet.id, sheet.tables[0].id);
  expect(reopened.getCell(sheet.id, 0, 3).f).toBe('SUM($A$2:$A$3)+IF(TRUE,1,100)+IF(FALSE,100,2)');
  expect(reopened.getValue(sheet.id, 0, 3)).toBe(33);
});
