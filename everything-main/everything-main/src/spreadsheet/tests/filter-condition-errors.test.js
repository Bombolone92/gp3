import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup(formula) {
  const wb = new Workbook(); wb.setInput(wb.activeSheetId, 0, 5, `=${formula}`); return wb;
}
it.each([
  'FILTER({1;2},{"invalid";TRUE})',
  'FILTER({1;2},{TRUE;"invalid"})',
  'FILTER({1,2},{"invalid",TRUE})',
  'FILTER({1,2},{TRUE,"invalid"})',
  'FILTER({1;2},{"invalid";FALSE},"Empty")',
  'FILTER({1,2},{FALSE,"invalid"},"Empty")',
  'FILTER({1;2},"invalid")',
  'FILTER({1;2},{TRUE;TRUE},{"invalid";TRUE})',
])('reports a condition conversion error for %s', (formula) => {
  const wb = setup(formula), id = wb.activeSheetId;
  expect(wb.getValue(id, 0, 5)).toEqual({ error: '#VALUE!' });
  expect(wb.spillAt(id, 1, 5)).toBeNull();
});
it('lets IFERROR handle an invalid filter condition', () => {
  const wb = setup('IFERROR(FILTER({1;2},{"invalid";TRUE}),"Check conditions")');
  expect(wb.getValue(wb.activeSheetId, 0, 5)).toBe('Check conditions');
});
it('uses the current cell-backed mask and recovers through edits and undo', () => {
  const wb = setup('FILTER({10;20},A1:A2)'), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'TRUE'); wb.setInput(id, 1, 0, 'TRUE');
  expect(wb.getValue(id, 1, 5)).toBe(20);
  wb.setInput(id, 1, 0, 'invalid');
  expect(wb.getValue(id, 0, 5)).toEqual({ error: '#VALUE!' });
  expect(wb.getValue(id, 1, 5)).toBeNull();
  wb.undo(); expect(wb.getValue(id, 1, 5)).toBe(20);
});
it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('preserves condition errors through %s reopening', async (ext, write) => {
  let wb = setup('FILTER({10;20},{TRUE;"invalid"},"Empty")');
  wb = await workbookFromFile(await write(wb), `filter.${ext}`);
  expect(wb.getValue(wb.activeSheetId, 0, 5)).toEqual({ error: '#VALUE!' });
});
it('preserves supported Boolean coercions, explicit errors and empty-result behavior', () => {
  // Only the words TRUE and FALSE coerce from text; "0" or "1" as text is #VALUE!.
  const wb = setup('FILTER({1;2;3;4;5;6},{TRUE;FALSE;2;0;"TRUE";"FALSE"})'), id = wb.activeSheetId;
  expect(wb.rangeValues(id, { r1: 0, c1: 5, r2: 2, c2: 5 })).toEqual([[1],[3],[5]]);
  wb.setInput(id, 0, 5, '=FILTER({1;2},{TRUE;#DIV/0!})');
  expect(wb.getValue(id, 0, 5)).toEqual({ error: '#DIV/0!' });
  wb.setInput(id, 0, 5, '=FILTER({1;2},{FALSE;FALSE},"Empty")');
  expect(wb.getValue(id, 0, 5)).toBe('Empty');
  wb.setInput(id, 0, 5, '=FILTER({1;2},{FALSE;FALSE})');
  expect(wb.getValue(id, 0, 5)).toEqual({ error: '#CALC!' });
});
