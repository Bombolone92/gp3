import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

it.each(['42', 'text', 'TRUE', '', '=1/0'])('uses the source sheet of a reference whose cell contains %s', (input) => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Other').id;
  wb.setInput(other, 0, 0, input);
  wb.setInput(id, 0, 2, '=SHEET(Other!A1)');
  expect(wb.getValue(id, 0, 2)).toBe(2);
  wb.moveSheet(other, 0);
  expect(wb.getValue(id, 0, 2)).toBe(1);
  wb.undo();
  expect(wb.getValue(id, 0, 2)).toBe(2);
});

it.each(['Other!A1:A2', 'Source', 'Sales', 'Sales[Value]', 'OFFSET(Other!A1,0,0)', 'INDIRECT("Other!A1")'])('accepts the reference %s', (reference) => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Other').id;
  wb.setInput(other, 0, 0, 'Value'); wb.setInput(other, 1, 0, '42');
  wb.addTable(other, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Sales' });
  wb.defineName('Source', 'Other!$A$1');
  wb.setInput(id, 0, 2, `=SHEET(${reference})`);
  expect(wb.getValue(id, 0, 2)).toBe(2);
});

it('preserves sheet-name lookup, current-sheet lookup, and invalid-reference errors', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addSheet('Other');
  for (const [formula, expected] of [
    ['SHEET()', 1], ['SHEET("Other")', 2], ['SHEET("Missing")', { error: '#N/A' }],
    ['SHEET(Missing!A1)', { error: '#REF!' }], ['SHEET(#REF!)', { error: '#REF!' }],
  ]) {
    wb.setInput(id, 0, 0, `=${formula}`);
    expect(wb.getValue(id, 0, 0)).toEqual(expected);
  }
  wb.setInput(id, 0, 0, '=SHEET(A1)');
  expect(wb.getValue(id, 0, 0)).toBe(1);
});

it.each(['SUM(Sales[@Value])', 'SUM([@Value])', 'SUM([Value])'])('keeps exported %s live through sheet renaming and reordering', async (formula) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 0, 1, 'Result');
  wb.setInput(id, 1, 0, '10'); wb.setInput(id, 2, 0, '20');
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  wb.defineName('Current', formula); wb.setInput(id, 1, 1, '=Current');
  const expected = wb.getValue(id, 1, 1);
  const reopened = await workbookFromFile(await workbookToOds(wb), 'source.ods'), target = reopened.activeSheetId;
  expect(reopened.getValue(target, 1, 1)).toBe(expected);
  reopened.renameSheet(target, "Plan's new data");
  expect(reopened.getValue(target, 1, 1)).toBe(expected);
  reopened.addSheet('First'); reopened.moveSheet(target, 1);
  expect(reopened.getValue(target, 1, 1)).toBe(expected);
  reopened.undo();
  expect(reopened.getValue(target, 1, 1)).toBe(expected);
  const again = await workbookFromFile(await workbookToOds(reopened), 'renamed.ods');
  expect(again.getValue(again.sheetByName("Plan's new data").id, 1, 1)).toBe(expected);
});
