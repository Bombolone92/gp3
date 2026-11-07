import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

function source(formula = 'Charge(100)') {
  return new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { f: formula }, '1,1': { v: 5 } } }, { name: 'External' }], names: [
    { name: 'Rate', ref: '0.2' }, { name: 'Charge', ref: 'LAMBDA(x,x*Rate)', sheet: 'Data' },
    { name: 'Unused', ref: '999' }, { name: 'OtherLocal', ref: '8', sheet: 'External' },
  ] });
}
const destination = () => new Workbook({ sheets: [{ name: "Plan's data", color: '#ff0000' }, { name: 'Existing' }], names: [
  { name: 'Rate', ref: '0.9' }, { name: 'Keep', ref: '7', sheet: "Plan's data" },
] });
const value = (wb, id = wb.sheets[0].id, r = 0, c = 0) => wb.getValue(id, r, c);
const replace = (wb, src) => wb.replaceSheetWith(wb.sheets[0].id, src, src.sheets[0].id);

it('retains transitive formulas without changing other sheets or the source', () => {
  const src = source(), before = src.toJSON(), wb = destination(), existing = wb.sheets[1].id;
  expect(value(src)).toBe(20);
  wb.setInput(existing, 0, 0, '=Rate*100');
  const sheet = replace(wb, src);
  expect(value(wb)).toBe(20); expect(value(wb, existing)).toBe(90);
  expect(wb.namedEntry('Rate', sheet.name)).toEqual({ name: 'Rate', ref: '0.2', sheet: sheet.name });
  expect(wb.namedEntry('Keep', sheet.name).ref).toBe('7');
  expect(wb.names.some(n => ['Unused', 'OtherLocal'].includes(n.name))).toBe(false);
  expect(src.toJSON()).toEqual(before);
  wb.defineName('Rate', '0.4', sheet.name); expect(value(wb)).toBe(40);
  expect(value(wb, existing)).toBe(90);
});
it('rebinds named references and qualified calls to the retained sheet name', () => {
  const src = source('Data!Charge(SUM(Values))'); src.defineName('Values', 'Data!$B$2');
  expect(value(src)).toBe(1);
  const wb = destination(), sheet = replace(wb, src);
  expect(value(wb)).toBe(1);
  expect(wb.namedEntry('Values', sheet.name).ref).toBe("'Plan''s data'!$B$2");
  wb.setInput(sheet.id, 1, 1, '10'); expect(value(wb)).toBe(2);
});
it('keeps source-local precedence and replaces a conflicting destination local', () => {
  const src = source(); src.defineName('rate', '0.3', 'Data');
  const wb = destination(); wb.defineName('Rate', '0.8', wb.sheets[0].name);
  replace(wb, src); expect(value(wb)).toBe(30);
  expect(wb.names.filter(n => n.sheet === wb.sheets[0].name && n.name.toLowerCase() === 'rate')).toHaveLength(1);
});
it('does not make same-workbook copies stop following shared global names', () => {
  const wb = source(), [data, target] = wb.sheets;
  wb.replaceSheetWith(target.id, wb, data.id);
  expect(value(wb, target.id)).toBe(20);
  wb.defineName('Rate', '0.4'); expect(value(wb, target.id)).toBe(40); expect(value(wb, data.id)).toBe(40);
  expect(wb.names.filter(n => n.name === 'Rate')).toHaveLength(1);
});
it('rewrites named table dependencies when imported tables collide', () => {
  const src = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 5 }, '0,2': { f: 'Total' } },
    tables: [{ id: 'items', name: 'Items', range: { r1: 0, c1: 0, r2: 1, c2: 0 } }] }], names: [{ name: 'Total', ref: 'SUM(Items)' }] });
  const wb = destination(), id = wb.sheets[1].id;
  wb.setInput(id, 0, 0, 'Amount'); wb.setInput(id, 1, 0, '9'); wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Items' });
  wb.setInput(id, 0, 2, '=SUM(Items)');
  const sheet = replace(wb, src);
  expect(value(wb, sheet.id, 0, 2)).toBe(5); expect(value(wb, id, 0, 2)).toBe(9);
  expect(wb.namedEntry('Total', sheet.name).ref).toBe('SUM(Items2)');
});
it('retains named dependencies used only by calculated-column templates', () => {
  const src = source('1'), json = src.toJSON();
  json.sheets[0].cells = { '0,0': { v: 'Value' }, '0,1': { v: 'Fee' }, '1,0': { v: 10 } };
  json.sheets[0].tables = [{ id: 'items', name: 'Items', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, calc: { 1: 'Charge([@Value])' } }];
  const wb = destination(), sheet = replace(wb, new Workbook(json));
  const row = wb.addTableRow(sheet.id, sheet.tables[0].id); wb.setInput(sheet.id, row, 0, '50');
  expect(value(wb, sheet.id, row, 1)).toBe(10);
});
it('retains names used only in formatting, validation, and filter criteria', () => {
  const src = source('10'), id = src.sheets[0].id;
  src.defineName('Threshold', '5'); src.defineName('ValidationFloor', '4'); src.defineName('FilterFloor', '6');
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  src.addRule(id, { type: 'formula', range, value: 'A1>Threshold', style: { bold: true } });
  src.addValidation(id, { type: 'formula', range, source: 'A1>ValidationFloor', strict: true });
  const json = src.toJSON(); json.sheets[0].cells['1,0'] = { v: 3 }; json.sheets[0].cells['2,0'] = { v: 9 };
  json.sheets[0].filter = { range, criteria: { 0: { formula: 'A2>FilterFloor' } } };
  const wb = destination(), sheet = replace(wb, new Workbook(json));
  expect(wb.conditionalStyle(sheet.id, 0, 0, 10)).toMatchObject({ bold: true });
  expect(wb.validateInput(sheet.id, 0, 0, '10').ok).toBe(true);
  expect(wb.validateInput(sheet.id, 0, 0, '3').ok).toBe(false);
  wb.reapplyFilter(sheet.id); expect([...sheet.filterHidden]).toEqual([1]);
});
it('keeps list sources as live named references after replacement', () => {
  const src = source('1'), id = src.sheets[0].id;
  src.defineName('Options', 'Data!$B$2'); src.addValidation(id, { type: 'list', range: { r1: 0, c1: 3, r2: 1, c2: 3 }, source: '=Options', strict: true });
  const wb = destination(), sheet = replace(wb, src), rule = sheet.validations[0];
  expect(wb.listOptionsFor(sheet.id, rule)).toEqual(['5']);
  wb.setInput(sheet.id, 1, 1, '8'); expect(wb.listOptionsFor(sheet.id, rule)).toEqual(['8']);
});
it('retains dynamically selected names without evaluating them during copying', () => {
  const src = source('INDIRECT("Val"&"ues")'); src.defineName('Values', 'Data!$B$2');
  const wb = destination(); replace(wb, src); expect(value(wb)).toBe(5);
});
it('preserves missing external-sheet errors and cyclic name errors', () => {
  const src = source('Elsewhere'); src.defineName('Elsewhere', 'External!B2');
  const wb = destination(); replace(wb, src); expect(value(wb)).toEqual({ error: '#REF!' });
  src.defineName('Loop', 'Again+0'); src.defineName('Again', 'Loop'); src.setInput(src.sheets[0].id, 0, 0, '=Loop');
  replace(wb, src); expect(value(wb)).toEqual({ error: '#CYCLE!' });
});
it('restores names and sheet metadata in the same undo step', () => {
  const wb = destination(), sheet = wb.sheets[0]; wb.defineName('Rate', '0.8', sheet.name);
  const before = wb.toJSON(); replace(wb, source()); const after = wb.toJSON();
  expect(value(wb)).toBe(20); expect(wb.sheets[0]).toMatchObject({ id: sheet.id, name: sheet.name, color: sheet.color });
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.toJSON()).toEqual(after); expect(value(wb)).toBe(20);
});
it.each([['ods', workbookToOds], ['xlsx', workbookToXlsx]])('preserves replacement name bindings through %s reopening', async (ext, write) => {
  let wb = destination(); replace(wb, source());
  wb = await workbookFromFile(await write(wb), `replaced.${ext}`); expect(value(wb)).toBe(20);
  expect(wb.namedEntry('Rate', 'Existing').ref).toBe('0.9');
});
