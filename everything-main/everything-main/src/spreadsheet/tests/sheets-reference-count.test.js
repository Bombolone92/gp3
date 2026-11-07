import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  const middle = wb.addSheet('Middle').id, last = wb.addSheet('Last').id;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Sales' });
  wb.defineName('Source', 'Sheet1!$A$2');
  wb.defineName('Across', 'Sheet1:Middle!$A$1');
  const value = (formula) => { wb.setInput(last, 5, 5, `=${formula}`); return wb.getValue(last, 5, 5); };
  return { wb, id, middle, last, value };
}

it.each(['A1', 'Sheet1!A1:A2', 'Source', 'Sales', 'Sales[Value]', 'OFFSET(Sheet1!A1,0,0)', 'INDIRECT("Sheet1!A1")', 'LET(x,Sheet1!A1,SHEETS(x))'])('counts one sheet for %s', (ref) => {
  const { value } = setup();
  expect(value(ref.startsWith('LET(') ? ref : `SHEETS(${ref})`)).toBe(1);
});

it.each(['Sheet1:Middle!A1', 'Middle:Sheet1!A1', 'Sheet1:Middle!A1:B2', 'Across'])('counts only the sheets in %s', (ref) => {
  const { value } = setup();
  expect(value(`SHEETS(${ref})`)).toBe(2);
});

it.each(['42', 'TRUE', '"Middle"', '{1,2}', '#REF!', 'Missing!A1'])('rejects a non-reference or invalid reference: %s', (ref) => {
  expect(setup().value(`SHEETS(${ref})`)).toEqual({ error: '#REF!' });
});

it('counts valid references even when their cells contain errors', () => {
  const { wb, id, value } = setup();
  wb.setInput(id, 0, 2, '=1/0');
  expect(value('SHEETS(Sheet1!C1)')).toBe(1);
  expect(value('SHEETS(Sheet1:Middle!C1)')).toBe(2);
});

it('tracks workbook size and sheet-span membership through moves, hiding, and undo', () => {
  const { wb, middle, last, value } = setup();
  expect(value('SHEETS()')).toBe(3);
  wb.setSheetHidden(middle, true);
  expect(value('SHEETS()')).toBe(3);
  expect(value('SHEETS(Sheet1:Middle!A1)')).toBe(2);
  wb.moveSheet(last, 1);
  expect(wb.getValue(last, 5, 5)).toBe(3);
  wb.undo();
  expect(wb.getValue(last, 5, 5)).toBe(2);
  wb.addSheet('Extra');
  expect(value('SHEETS()')).toBe(4);
  expect(value('SHEETS(Sheet1:Middle!A1)')).toBe(2);
});

it('preserves reference-specific counts in XLSX files', async () => {
  const { wb, last, value } = setup();
  expect(value('SHEETS(Across)')).toBe(2);
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'sheet-counts.xlsx');
  expect(reopened.getValue(reopened.sheetByName('Last').id, 5, 5)).toBe(2);
  expect(wb.getValue(last, 5, 5)).toBe(2);
});
