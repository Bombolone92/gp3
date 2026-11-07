// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';

it.each(['cell', 'append', 'replace'])('captures source results before rewriting formulas during %s import', mode => {
  const other = new Workbook({ sheets: [{ name: 'Values' }, { name: 'Data' }] });
  const [values, data] = other.sheets;
  other.setInput(values.id, 0, 0, '7');
  other.setInput(data.id, 0, 0, '=Values!A1');
  other.setInput(data.id, 0, 1, '=IF(ISFORMULA(Data!A1),Values!A1,-1)');
  other.setInput(data.id, 0, 2, '=Data!D1');
  other.setInput(data.id, 0, 3, '3');
  other.setInput(data.id, 0, 4, '=IF(FORMULATEXT(Data!C1)="=Data!D1",Values!A1,-2)');
  const original = other.toJSON();
  const expected = [7, 7, 3, 3, 7];
  expect(expected.map((_, c) => other.getValue(data.id, 0, c))).toEqual(expected);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  const before = wb.toJSON(); wb.clearHistory();
  placeImport(wb, id, other, { mode, otherSheetId: data.id, at: { r: 4, c: 2 } });
  const [r0, c0] = mode === 'cell' ? [4, 2] : mode === 'append' ? [1, 0] : [0, 0];
  expect(expected.map((_, c) => wb.getValue(id, r0, c0 + c))).toEqual(expected);
  expect(wb.getCell(id, r0, c0 + 2).f).toBeTruthy();
  expect(wb.getCell(id, r0, c0 + 1).f).toBeNull();
  expect(wb.getCell(id, r0, c0 + 4).f).toBeNull();
  expect(other.toJSON()).toEqual(original);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(expected.map((_, c) => wb.getValue(id, r0, c0 + c))).toEqual(expected);
});

it('captures a spilled range and formulas that inspect its anchor from the same source state', () => {
  const other = new Workbook({ sheets: [{ name: 'Values' }, { name: 'Data' }] });
  const [values, data] = other.sheets;
  other.setInput(values.id, 0, 0, '7');
  other.setInput(values.id, 1, 0, '9');
  other.setInput(data.id, 0, 0, '=Values!A1:A2', { style: { fmt: 'currency', dec: 2, cur: 'USD' } });
  other.setInput(data.id, 0, 1, '=SUM(Values!A1:A2)+IF(ISFORMULA(Data!A1),1,0)');
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 3, c: 2 } });
  expect(wb.getValue(id, 3, 2)).toBe(7);
  expect(wb.getValue(id, 4, 2)).toBe(9);
  expect(wb.getValue(id, 3, 3)).toBe(17);
  expect(wb.getCell(id, 4, 2).s).toMatchObject({ fmt: 'currency', dec: 2, cur: 'USD' });
});

it('preserves errors and linked values when their original formulas cannot accompany the import', () => {
  const other = new Workbook({ sheets: [{ name: 'Values' }, { name: 'Data' }] });
  const [values, data] = other.sheets;
  other.setInput(values.id, 0, 0, '7');
  other.setInput(values.id, 1, 0, '=1/0');
  other.setInput(data.id, 0, 0, '=Values!A1:A2');
  other.setInput(data.id, 0, 1, '=HYPERLINK("https://example.test/",Values!A1)');
  other.setInput(data.id, 1, 1, '=Values!A2');
  const wb = new Workbook(), id = wb.activeSheetId;
  placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 3, c: 2 } });
  expect(wb.getCell(id, 3, 2)).toMatchObject({ v: 7, f: null });
  expect(wb.getCell(id, 4, 2)).toMatchObject({ v: { error: '#DIV/0!' }, f: null });
  expect(wb.getCell(id, 3, 3)).toMatchObject({ v: 7, f: null });
  expect(wb.getCell(id, 4, 3)).toMatchObject({ v: { error: '#DIV/0!' }, f: null });
});

it('reads protected formulas without editing them or recording history', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(2)');
  wb.setSheetProtected(id, true);
  wb.clearHistory();
  const before = wb.toJSON();
  const area = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const snapshot = wb.formulaValueSnapshot(id, [area, area]);
  expect(snapshot.count).toBe(1);
  expect(snapshot.entries.map(({ r, c, cell }) => [r, c, cell.v, cell.f])).toEqual([[0, 0, 1, null], [1, 0, 2, null]]);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
