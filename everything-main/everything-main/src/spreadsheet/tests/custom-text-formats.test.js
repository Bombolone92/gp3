import { expect, it } from 'vitest';
import { formatValue, editText } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile, sheetToCsv } from '../src/core/io.js';

it.each([
  ['@ "units"', 'hello units'],
  ['"Label: "@', 'Label: hello'],
  ['0;0;0;"Text: "@', 'Text: hello'],
  ['0;0;0;"fixed label"', 'fixed label'],
  ['0;0;0;', ''],
  ['0.00', 'hello'],
  ['0"@"', 'hello'],
  ['0\\@', 'hello'],
])('uses custom code %s for text cells', (code, expected) => {
  expect(formatValue('hello', { fmt: 'custom', code })).toBe(expected);
  expect(formatWithCode('hello', code)).toBe(expected);
});

it('formats calculated and spilled text while keeping values and edit text intact', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'hello');
  wb.setInput(id, 0, 1, '=VSTACK("one","two")');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { fmt: 'custom', code: '"Label: "@' });
  expect(wb.getDisplay(id, 0, 0)).toBe('Label: hello');
  expect(wb.getDisplay(id, 0, 1)).toBe('Label: one');
  expect(wb.getDisplay(id, 1, 1)).toBe('Label: two');
  expect(wb.getDisplay(id, 1, 0)).toBe('');
  expect(wb.getValue(id, 0, 0)).toBe('hello');
  expect(wb.getValue(id, 1, 1)).toBe('two');
  expect(editText(wb.getCell(id, 0, 0))).toBe('hello');
  expect(sheetToCsv(wb, id)).toContain('Label: hello,Label: one');
  const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'text.xlsx');
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('Label: hello');
  expect(back.getDisplay(back.activeSheetId, 1, 1)).toBe('Label: two');
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe('hello');
});

it('keeps errors, blanks, and ordinary text styles unchanged while formatting Boolean spelling', () => {
  const style = { fmt: 'custom', code: '"Label: "@' };
  expect(formatValue(null, style)).toBe('');
  expect(formatValue(true, style)).toBe('Label: TRUE');
  expect(formatValue({ error: '#VALUE!' }, style)).toBe('#VALUE!');
  expect(formatValue('hello', { fmt: 'text' })).toBe('hello');
  expect(formatValue('hello', { fmt: 'custom' })).toBe('hello');
});

it('updates table references when a text format changes the displayed header', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Qty');
  wb.setInput(id, 1, 0, '10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Sales' });
  wb.setInput(id, 0, 2, '=SUM(Sales[Qty])');
  wb.clearHistory();
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '"Total "@' });
  expect(wb.getDisplay(id, 0, 0)).toBe('Total Qty');
  expect(wb.getCell(id, 0, 2).f).toContain('Total Qty');
  expect(wb.getValue(id, 0, 2)).toBe(10);
  wb.undo();
  expect(wb.getDisplay(id, 0, 0)).toBe('Qty');
  expect(wb.getCell(id, 0, 2).f).toBe('SUM(Sales[Qty])');
});
