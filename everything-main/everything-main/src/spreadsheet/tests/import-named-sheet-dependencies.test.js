// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';

function source(formula) {
  const wb = new Workbook({ sheets: [{ name: 'Values' }, { name: 'Data' }] });
  const [values, data] = wb.sheets;
  wb.setInput(values.id, 0, 0, '7');
  wb.setInput(values.id, 1, 0, '9');
  wb.defineName('Original', 'Values!$A$1');
  wb.defineName('Twice', 'Original*2');
  wb.defineName('Scale', 'LAMBDA(x,x*Original)');
  wb.setInput(data.id, 0, 0, `=${formula}`);
  return { wb, data };
}

const formulas = ['Original*2', 'Twice', 'Scale(2)', 'LET(Original,100,Twice)', 'SUM(MAP({2},Scale))'];
it.each(['cell', 'append', 'replace'].flatMap(mode => formulas.map(formula => [mode, formula])))
  ('keeps %s import results when %s reaches another sheet through names', (mode, formula) => {
    const { wb: other, data } = source(formula);
    const beforeSource = other.toJSON();
    const wb = new Workbook({ sheets: [{ name: 'Target' }, { name: 'Values' }] });
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Existing');
    wb.setInput(wb.sheets[1].id, 0, 0, '100');
    const before = wb.toJSON();
    wb.clearHistory();
    expect(other.getValue(data.id, 0, 0)).toBe(14);
    expect(placeImport(wb, id, other, { mode, otherSheetId: data.id, at: { r: 4, c: 2 } })).toBeTruthy();
    const [r, c] = mode === 'cell' ? [4, 2] : mode === 'append' ? [1, 0] : [0, 0];
    expect(wb.getCell(id, r, c)).toMatchObject({ v: 14, f: null });
    expect(wb.getValue(wb.sheets[1].id, 0, 0)).toBe(100);
    expect(other.toJSON()).toEqual(beforeSource);
    wb.undo(); expect(wb.toJSON()).toEqual(before);
    wb.redo(); expect(wb.getValue(id, r, c)).toBe(14);
  });

it('copies all values spilled by a name that reads a missing source sheet', () => {
  const { wb: other, data } = source('ImportedRows');
  other.defineName('ImportedRows', 'Values!$A$1:$A$2');
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 2, c: 0 } });
  expect(wb.getCell(id, 2, 0)).toMatchObject({ v: 7, f: null });
  expect(wb.getCell(id, 3, 0)).toMatchObject({ v: 9, f: null });
});

it('keeps local bindings and built-in calls as formulas despite unrelated foreign names', () => {
  const { wb: other, data } = source('LET(Original,3,Original*2)+SUM(1,2)');
  other.defineName('SUM', 'Values!A1');
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 2, c: 0 } });
  expect(wb.getCell(id, 2, 0).f).toBe('LET(Original,3,Original*2)+SUM(1,2)');
  expect(wb.getValue(id, 2, 0)).toBe(9);
});

it('uses sheet-local name precedence and preserves names that stay within a replaced sheet', () => {
  const { wb: other, data } = source('Twice');
  other.defineName('Original', 'Data!$B$2', 'Data');
  other.setInput(data.id, 1, 1, '3');
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'replace', otherSheetId: data.id });
  expect(wb.getCell(id, 0, 0).f).toBe('Twice');
  expect(wb.getValue(id, 0, 0)).toBe(6);
  wb.setInput(id, 1, 1, '5');
  expect(wb.getValue(id, 0, 0)).toBe(10);
});

it('finishes cyclic name dependencies and keeps the original error', () => {
  const { wb: other, data } = source('Loop');
  other.defineName('Loop', 'Again+Original');
  other.defineName('Again', 'Loop');
  const wb = new Workbook(), id = wb.activeSheetId;
  const value = other.getValue(data.id, 0, 0);
  expect(value).toEqual({ error: '#CYCLE!' });
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 2, c: 0 } });
  expect(wb.getValue(id, 2, 0)).toEqual(value);
  expect(wb.getCell(id, 2, 0).f).toBeNull();
});

it.each(['SUM(Items)', 'SUM(Items[Amount])'])('follows names that reach an outside table through %s', (ref) => {
  const { wb: other, data } = source('Total');
  const values = other.sheets[0];
  other.setInput(values.id, 0, 0, 'Amount');
  other.addTable(values.id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Items' });
  other.defineName('Total', ref);
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 2, c: 0 } });
  expect(wb.getCell(id, 2, 0)).toMatchObject({ v: 9, f: null });
});

it('leaves a long formula with a locally bound name live', () => {
  const formula = `LET(Original,2,${'1+'.repeat(3500)}Original)`;
  const { wb: other, data } = source(formula);
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 2, c: 0 } });
  expect(wb.getCell(id, 2, 0).f).toBe(formula);
  expect(wb.getValue(id, 2, 0)).toBe(3502);
});

it('still brings the complete file in with live names and cross-sheet calculations', () => {
  const { wb: other, data } = source('Twice');
  const wb = new Workbook();
  expect(placeImport(wb, wb.activeSheetId, other, { mode: 'sheets' })).toBe('Added 2 sheets');
  const imported = wb.sheetByName(data.name);
  expect(wb.getCell(imported.id, 0, 0).f).toBe('Twice');
  expect(wb.getValue(imported.id, 0, 0)).toBe(14);
  wb.setInput(wb.sheetByName('Values').id, 0, 0, '10');
  expect(wb.getValue(imported.id, 0, 0)).toBe(20);
});
