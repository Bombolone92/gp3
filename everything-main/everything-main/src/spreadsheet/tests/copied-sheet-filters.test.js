import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
function source(criterion = { op: 'gt', value: 5 }) {
  return new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Value' }, '1,0': { v: 3 }, '2,0': { v: 9 }, '0,2': { f: 'SUBTOTAL(9,A2:A3)' } },
    filter: { range, criteria: { 0: criterion } } }], names: [{ name: 'Floor', ref: '5', sheet: 'Data' }] });
}
function copy(method, src) {
  if (method === 'duplicate') return { wb: src, sheet: src.duplicateSheet(src.sheets[0].id) };
  const wb = new Workbook({ sheets: [{ name: 'Main' }] });
  return { wb, sheet: method === 'import' ? wb.importSheets(src)[0] : wb.replaceSheetWith(wb.activeSheetId, src, src.sheets[0].id) };
}
it.each(['duplicate', 'import', 'replace'].flatMap(method => [
  { op: 'gt', value: 5 }, { values: ['9'] }, { formula: 'A2>Floor' },
].map(criterion => ({ method, criterion }))))('initializes $criterion filters on $method', ({ method, criterion }) => {
  const src = source(criterion), original = src.sheets[0], before = src.toJSON();
  expect([...original.filterHidden]).toEqual([1]);
  const { wb, sheet } = copy(method, src);
  expect([...sheet.filterHidden]).toEqual([1]);
  expect(wb.rowHeight(sheet.id, 1)).toBe(0); expect(wb.rowHeight(sheet.id, 2)).toBeGreaterThan(0);
  expect(wb.getValue(sheet.id, 0, 2)).toBe(9);
  expect([...original.filterHidden]).toEqual([1]);
  if (method !== 'duplicate') expect(src.toJSON()).toEqual(before);
  wb.undo(); wb.redo(); expect([...wb.sheet(sheet.id).filterHidden]).toEqual([1]);
  expect(wb.getValue(sheet.id, 0, 2)).toBe(9);
});
it('replaces a sheet using incoming data after the destination cache has been read', () => {
  const src = source(), wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 0, '90'); wb.setInput(id, 2, 0, '1');
  expect(wb.getValue(id, 1, 0)).toBe(90); expect(wb.getValue(id, 2, 0)).toBe(1);
  let hiddenAtNotification;
  wb.addEventListener('change', event => { if (event.detail.type === 'structure') hiddenAtNotification = [...wb.sheet(id).filterHidden]; });
  wb.replaceSheetWith(id, src, src.activeSheetId);
  expect(hiddenAtNotification).toEqual([1]);
  expect(wb.getValue(id, 0, 2)).toBe(9);
});
it('initializes imported filters after cross-sheet formulas can resolve', () => {
  const src = source({ formula: 'A2>Limits!A1' });
  const limits = src.addSheet('Limits'); src.setInput(limits.id, 0, 0, '5'); src.reapplyFilter(src.sheets[0].id);
  const wb = new Workbook(), [data] = wb.importSheets(src);
  expect([...data.filterHidden]).toEqual([1]); expect(wb.getValue(data.id, 0, 2)).toBe(9);
});
it('keeps manual hidden rows and existing destination filters intact', () => {
  const src = source(), json = src.toJSON(); json.sheets[0].hiddenRows = [2];
  const wb = source(), original = wb.sheets[0], [added] = wb.importSheets(new Workbook(json));
  expect([...added.filterHidden]).toEqual([1]); expect(wb.rowHeight(added.id, 2)).toBe(0);
  expect([...original.filterHidden]).toEqual([1]); expect(wb.rowHeight(original.id, 2)).toBeGreaterThan(0);
});
it('keeps the same visible rows before and after XLSX reopening', async () => {
  let { wb, sheet } = copy('replace', source());
  expect([...sheet.filterHidden]).toEqual([1]);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'filters.xlsx');
  expect([...wb.sheets[0].filterHidden]).toEqual([1]); expect(wb.getValue(wb.sheets[0].id, 0, 2)).toBe(9);
});
