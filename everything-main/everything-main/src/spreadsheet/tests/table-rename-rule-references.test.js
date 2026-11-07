import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const dataRange = { r1: 0, c1: 0, r2: 2, c2: 0 };
function source() {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 3 }, '2,0': { v: 9 } },
    tables: [{ id: 'items', name: 'Items', range: dataRange }] }, { name: 'Consumer', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 3 }, '2,0': { v: 9 }, '0,3': { v: 15 } } }] });
  for (const sheet of wb.sheets) {
    wb.addValidation(sheet.id, { type: 'list', range: { r1: 0, c1: 2, r2: 0, c2: 2 }, source: '=Items[Amount]', strict: true, chips: true, prompt: 'Choose an amount' });
    wb.addValidation(sheet.id, { type: 'formula', range: { r1: 0, c1: 3, r2: 0, c2: 3 }, source: 'D1<=MAX(Items[Amount])', strict: true });
    wb.addRule(sheet.id, { type: 'formula', range: { r1: 0, c1: 3, r2: 0, c2: 3 }, value: 'D1>MAX(Items[Amount])', style: { bold: true } });
    wb.setFilterRange(sheet.id, dataRange); wb.setFilterCriteria(sheet.id, 0, { formula: 'A2>=AVERAGE(Items[Amount])' });
  }
  wb.clearHistory(); return wb;
}
const rename = wb => wb.updateTable(wb.sheets[0].id, 'items', { name: 'Orders' });
it.each([0, 1])('updates dropdowns and custom validation on sheet %s', index => {
  const wb = source(), sheet = wb.sheets[index];
  expect(wb.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['3', '9']);
  expect(rename(wb)).toBe(true);
  expect(sheet.validations[0]).toMatchObject({ source: '=Orders[Amount]', chips: true, prompt: 'Choose an amount', strict: true });
  expect(sheet.validations[1].source).toBe('D1<=MAX(Orders[Amount])');
  expect(wb.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['3', '9']);
  expect(wb.validateInput(sheet.id, 0, 3, '15').ok).toBe(false);
  wb.setInput(wb.sheets[0].id, 2, 0, '20'); expect(wb.validateInput(sheet.id, 0, 3, '15').ok).toBe(true);
});
it('keeps conditional formatting and filter results stable and live', () => {
  const wb = source(), sheet = wb.sheets[1];
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)).toMatchObject({ bold: true });
  rename(wb);
  expect(sheet.rules[0].value).toBe('D1>MAX(Orders[Amount])');
  expect(sheet.filter.criteria[0].formula).toBe('A2>=AVERAGE(Orders[Amount])');
  expect([...sheet.filterHidden]).toEqual([1]); wb.reapplyFilter(sheet.id); expect([...sheet.filterHidden]).toEqual([1]);
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)).toMatchObject({ bold: true });
  wb.setInput(wb.sheets[0].id, 2, 0, '20');
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)?.bold).not.toBe(true);
});
it('retains local-name and lexical precedence while rewriting explicit table selectors', () => {
  const json = source().toJSON(); json.names = [{ name: 'Items', ref: '100', sheet: 'Consumer' }];
  json.sheets[0].rules[0].value = 'SUM(Items)>10'; json.sheets[1].rules[0].value = 'SUM(Items)>50';
  json.sheets[1].validations[1].source = 'LET(Items,5,D1<Items)';
  const wb = new Workbook(json); rename(wb);
  expect(wb.sheets[0].rules[0].value).toBe('SUM(Orders)>10');
  expect(wb.sheets[1].rules[0].value).toBe('SUM(Items)>50');
  expect(wb.sheets[1].validations[1].source).toBe('LET(Items,5,D1<Items)');
  expect(wb.sheets[1].validations[0].source).toBe('=Orders[Amount]');
  expect(wb.conditionalStyle(wb.sheets[1].id, 0, 3, 15)).toMatchObject({ bold: true });
});
it('preserves generated dependencies on protected sheets without allowing user edits', () => {
  const wb = source(), sheet = wb.sheets[1]; wb.setSheetProtected(sheet.id, true); const before = wb.toJSON();
  rename(wb);
  expect(sheet.protected).toBe(true); expect(sheet.validations[0].source).toBe('=Orders[Amount]');
  expect(sheet.rules[0].value).toBe('D1>MAX(Orders[Amount])');
  expect(sheet.filter.criteria[0].formula).toBe('A2>=AVERAGE(Orders[Amount])');
  wb.setInput(sheet.id, 0, 3, '7'); expect(wb.getValue(sheet.id, 0, 3)).toBe(15);
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo();
  expect(wb.sheet(sheet.id).validations[0].source).toBe('=Orders[Amount]');
});
it('restores all rule metadata in the table rename undo step', () => {
  const wb = source(), before = wb.toJSON(); rename(wb); const after = wb.toJSON();
  expect(wb.sheets[1].validations[0].source).toBe('=Orders[Amount]');
  wb.undo(); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
  for (const sheet of wb.sheets) expect(wb.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['3', '9']);
});
it('keeps literal text, list arrays, and nonformula rules unchanged', () => {
  const json = source().toJSON(), sheet = json.sheets[1];
  sheet.validations[0].source = ['Items[Amount]', '=Items']; sheet.rules[0] = { ...sheet.rules[0], type: 'contains', value: 'Items' };
  sheet.filter.criteria[0] = { text: 'Items' }; sheet.validations[1].source = 'AND("Items"="Items",SUM(Items)>10)';
  const wb = new Workbook(json); rename(wb);
  expect(wb.sheets[1].validations[0].source).toEqual(['Items[Amount]', '=Items']);
  expect(wb.sheets[1].rules[0].value).toBe('Items'); expect(wb.sheets[1].filter.criteria[0]).toEqual({ text: 'Items' });
  expect(wb.sheets[1].validations[1].source).toBe('AND("Items"="Items",SUM(Orders)>10)');
});
it('refuses a rename on a protected owner without changing any rules', () => {
  // Protecting the sheet is setup, and is an undo step of its own; forget it so canUndo() below
  // reports only what the refused rename did, which is nothing.
  const wb = source(); wb.setSheetProtected(wb.sheets[0].id, true); wb.clearHistory(); const before = wb.toJSON();
  expect(rename(wb)).toBe(false); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});
it('preserves renamed rule behavior through XLSX reopening', async () => {
  let wb = source(); rename(wb); wb = await workbookFromFile(await workbookToXlsx(wb), 'renamed.xlsx');
  const sheet = wb.sheetByName('Consumer');
  expect(wb.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['3', '9']);
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)).toMatchObject({ bold: true });
  expect([...sheet.filterHidden]).toEqual([1]);
});
