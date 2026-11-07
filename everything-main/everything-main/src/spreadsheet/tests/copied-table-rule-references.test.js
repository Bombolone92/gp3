import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const dataRange = { r1: 0, c1: 0, r2: 2, c2: 0 };
function source() {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 3 }, '2,0': { v: 9 }, '0,3': { v: 15 } },
    tables: [{ id: 'items', name: 'Items', range: dataRange }] }] }), id = wb.activeSheetId;
  wb.addValidation(id, { type: 'list', range: { r1: 0, c1: 2, r2: 0, c2: 2 }, source: '=Items[Amount]', strict: true });
  wb.addValidation(id, { type: 'formula', range: { r1: 0, c1: 3, r2: 0, c2: 3 }, source: 'D1<=MAX(Items[Amount])', strict: true });
  wb.addRule(id, { type: 'formula', range: { r1: 0, c1: 3, r2: 0, c2: 3 }, value: 'D1>MAX(Items[Amount])', style: { bold: true } });
  wb.setFilterRange(id, dataRange); wb.setFilterCriteria(id, 0, { formula: 'A2>=AVERAGE(Items[Amount])' });
  return wb;
}
function copy(method, src) {
  if (method === 'duplicate') return { wb: src, sheet: src.duplicateSheet(src.activeSheetId) };
  const wb = source(), existing = wb.activeSheetId, main = wb.addSheet('Main');
  wb.setInput(existing, 1, 0, '100'); wb.setInput(existing, 2, 0, '200');
  const sheet = method === 'import' ? wb.importSheets(src)[0] : wb.replaceSheetWith(main.id, src, src.activeSheetId);
  return { wb, sheet };
}
it.each(['duplicate', 'import', 'replace'])('keeps copied dropdowns bound to the %s table', method => {
  const src = source(), before = src.toJSON(), { wb, sheet } = copy(method, src);
  expect(sheet.tables[0].name).toBe('Items2');
  expect(sheet.validations[0].source).toBe('=Items2[Amount]');
  wb.setInput(sheet.id, 1, 0, '7');
  expect(wb.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['7', '9']);
  expect(wb.validateInput(sheet.id, 0, 2, '7').ok).toBe(true);
  expect(wb.validateInput(sheet.id, 0, 2, '3').ok).toBe(false);
  if (method !== 'duplicate') expect(src.toJSON()).toEqual(before);
});
it.each(['duplicate', 'import', 'replace'])('keeps custom validation and formatting bound to the %s table', method => {
  const src = source(), { wb, sheet } = copy(method, src);
  expect(sheet.validations[1].source).toBe('D1<=MAX(Items2[Amount])');
  expect(sheet.rules[0].value).toBe('D1>MAX(Items2[Amount])');
  expect(wb.validateInput(sheet.id, 0, 3, '15').ok).toBe(false);
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)).toMatchObject({ bold: true });
  wb.setInput(sheet.id, 2, 0, '20');
  expect(wb.validateInput(sheet.id, 0, 3, '15').ok).toBe(true);
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)?.bold).not.toBe(true);
});
it.each(['duplicate', 'import', 'replace'])('keeps filter criteria bound to the %s table', method => {
  const { wb, sheet } = copy(method, source());
  expect(sheet.filter.criteria[0].formula).toBe('A2>=AVERAGE(Items2[Amount])');
  expect([...sheet.filterHidden]).toEqual([1]);
  wb.setInput(sheet.id, 1, 0, '7'); wb.reapplyFilter(sheet.id);
  expect([...sheet.filterHidden]).toEqual([1]);
});
it.each([false, true])('resolves bare table references using the source sheet scope (local shadow=%s)', local => {
  const json = source().toJSON(); json.sheets.push({ name: 'Other' });
  json.names = [{ name: 'Items', ref: '100', sheet: local ? 'Data' : 'Other' }];
  json.sheets[0].rules[0].value = 'SUM(Items)>50';
  json.sheets[0].validations[1].source = 'D1<SUM(Items)';
  json.sheets[0].filter.criteria[0].formula = 'A2<SUM(Items)';
  const src = new Workbook(json), { wb, sheet } = copy('import', src), ref = local ? 'Items' : 'Items2';
  expect(sheet.rules[0].value).toBe(`SUM(${ref})>50`);
  expect(sheet.validations[1].source).toBe(`D1<SUM(${ref})`);
  expect(sheet.filter.criteria[0].formula).toBe(`A2<SUM(${ref})`);
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)?.bold === true).toBe(local);
  expect(wb.validateInput(sheet.id, 0, 3, '15').ok).toBe(local);
});
it('preserves lexical variables, literal lists, and nonformula criteria', () => {
  const json = source().toJSON(), sh = json.sheets[0];
  sh.rules[0].value = 'LET(Items,5,Items=5)'; sh.validations[0].source = ['Items[Amount]', '=Items'];
  sh.validations[1].source = 'LET(Items2,999,SUM(Items))>10'; sh.filter.criteria[0] = { text: 'Items[Amount]' };
  const wb = new Workbook(json), copy = wb.duplicateSheet(wb.activeSheetId);
  expect(copy.rules[0].value).toBe('LET(Items,5,Items=5)');
  expect(copy.validations[0].source).toEqual(['Items[Amount]', '=Items']);
  expect(copy.validations[1].source).toBe('LET(Items2,999,SUM(Items2[#Data]))>10');
  expect(copy.filter.criteria[0]).toEqual({ text: 'Items[Amount]' });
});
it('restores rule bindings and independent values through undo/redo', () => {
  const wb = source(), before = wb.toJSON(), original = wb.activeSheetId, copy = wb.duplicateSheet(original);
  const after = wb.toJSON();
  expect(copy.validations[0].source).toBe('=Items2[Amount]');
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb.setInput(copy.id, 1, 0, '7');
  expect(wb.listOptionsFor(copy.id, wb.sheet(copy.id).validations[0])).toEqual(['7', '9']);
  expect(wb.listOptionsFor(original, wb.sheet(original).validations[0])).toEqual(['3', '9']);
});
it('preserves copied rule references through XLSX reopening', async () => {
  let wb = source(); const copy = wb.duplicateSheet(wb.activeSheetId);
  wb.setInput(copy.id, 1, 0, '7'); wb.setInput(copy.id, 2, 0, '20'); wb.reapplyFilter(copy.id);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'copied.xlsx'); const sheet = wb.sheetByName(copy.name);
  expect(wb.listOptionsFor(sheet.id, sheet.validations[0])).toEqual(['7', '20']);
  expect(wb.validateInput(sheet.id, 0, 3, '15').ok).toBe(true);
  expect(wb.conditionalStyle(sheet.id, 0, 3, 15)?.bold).not.toBe(true);
  expect([...sheet.filterHidden]).toEqual([1]);
});
