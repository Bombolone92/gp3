// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';

// Appending a sheet's rows or placing them at a cell pastes its cells alone: no defined name
// and no table travels. A formula that used one kept its text and showed #VALUE!, #REF! or
// #NAME? where the file showed a number. Such a formula now arrives as the value it showed,
// as one reaching another sheet of the file already did; replacing a sheet still carries
// the names and tables with it, so its formulas stay live there.

function namedSource() {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const id = other.activeSheetId;
  other.setInput(id, 0, 0, '10');
  other.defineName('Rate', 'Data!$A$1');
  other.setInput(id, 1, 0, '=A1*Rate');
  other.setInput(id, 2, 0, '=LET(Rate,2,Rate*A1)');
  other.setInput(id, 3, 0, '=Nothing+1');
  expect(other.getValue(id, 1, 0)).toBe(100);
  expect(other.getValue(id, 2, 0)).toBe(20);
  expect(other.getValue(id, 3, 0)).toEqual({ error: '#NAME?' });
  return { other, id };
}

it.each([['append', 1, 0], ['cell', 3, 2]])('places a formula that uses a same-sheet name as its value in %s mode', (mode, r0, c0) => {
  const { other, id: src } = namedSource();
  const before = other.toJSON();
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  const original = wb.toJSON();
  wb.clearHistory();
  expect(placeImport(wb, id, other, { mode, otherSheetId: src, at: { r: 3, c: 2 } })).toBeTruthy();
  expect(wb.getCell(id, r0 + 1, c0)).toMatchObject({ v: 100, f: null });
  expect(wb.getValue(id, r0 + 1, c0)).toBe(100);
  // A name LET binds is the formula's own, and a name defined nowhere is an error either way: both stay formulas.
  expect(wb.getCell(id, r0 + 2, c0).f).toBeTruthy();
  expect(wb.getValue(id, r0 + 2, c0)).toBe(20);
  expect(wb.getCell(id, r0 + 3, c0).f).toBe('Nothing+1');
  expect(wb.names).toEqual([]);
  expect(other.toJSON()).toEqual(before);
  wb.undo(); expect(wb.toJSON()).toEqual(original);
  wb.redo(); expect(wb.getValue(id, r0 + 1, c0)).toBe(100);
});

it('still carries the name along when replacing the sheet, keeping the formula live', () => {
  const { other, id: src } = namedSource();
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'replace', otherSheetId: src });
  expect(wb.getCell(id, 1, 0).f).toBe('A1*Rate');
  expect(wb.getValue(id, 1, 0)).toBe(100);
  wb.setInput(id, 0, 0, '20');
  expect(wb.getValue(id, 1, 0)).toBe(400);
});

function tableSource() {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const id = other.activeSheetId;
  for (const [r, row] of [['Qty', 'Price', 'Total'], ['20', '15', '=[@Qty]*[@Price]'], ['1', '5', '=[@Qty]*[@Price]']].entries()) {
    row.forEach((text, c) => other.setInput(id, r, c, text));
  }
  other.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'Sales' });
  other.setInput(id, 4, 0, '=SUM(Sales[Total])');
  expect(other.getValue(id, 1, 2)).toBe(300);
  expect(other.getValue(id, 4, 0)).toBe(305);
  return { other, id };
}

it.each([['append', 1, 0], ['cell', 3, 2]])('places structured references as their values in %s mode, since the table does not travel', (mode, r0, c0) => {
  const { other, id: src } = tableSource();
  const before = other.toJSON();
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  expect(placeImport(wb, id, other, { mode, otherSheetId: src, at: { r: 3, c: 2 } })).toBeTruthy();
  expect(wb.getCell(id, r0 + 1, c0 + 2)).toMatchObject({ v: 300, f: null });
  expect(wb.getCell(id, r0 + 2, c0 + 2)).toMatchObject({ v: 5, f: null });
  expect(wb.getCell(id, r0 + 4, c0)).toMatchObject({ v: 305, f: null });
  expect(wb.getValue(id, r0 + 1, c0)).toBe(20);
  expect(wb.sheet(id).tables).toEqual([]);
  expect(other.toJSON()).toEqual(before);
});

it('still carries the table along when replacing the sheet', () => {
  const { other, id: src } = tableSource();
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'replace', otherSheetId: src });
  expect(wb.sheet(id).tables.map((t) => t.name)).toEqual(['Sales']);
  expect(wb.getCell(id, 4, 0).f).toBe('SUM(Sales[Total])');
  expect(wb.getValue(id, 4, 0)).toBe(305);
});

it('places a formula reading a table on another sheet of the file as its value in every mode', () => {
  const other = new Workbook({ sheets: [{ name: 'Items' }, { name: 'Data' }] });
  const [items, data] = other.sheets;
  other.setInput(items.id, 0, 0, 'Amount');
  other.setInput(items.id, 1, 0, '9');
  other.addTable(items.id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Stock' });
  other.setInput(data.id, 0, 0, '=SUM(Stock[Amount])');
  expect(other.getValue(data.id, 0, 0)).toBe(9);
  for (const mode of ['cell', 'append', 'replace']) {
    const wb = new Workbook(), id = wb.activeSheetId;
    placeImport(wb, id, other, { mode, otherSheetId: data.id, at: { r: 0, c: 0 } });
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 9, f: null });
  }
});
