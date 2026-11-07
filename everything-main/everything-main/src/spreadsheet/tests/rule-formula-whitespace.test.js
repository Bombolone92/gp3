import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';
const range = { r1: 1, c1: 0, r2: 2, c2: 0 };
function source(formula) {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '0,1': { v: 5 }, '1,0': { v: 3 }, '2,0': { v: 9 } },
    rules: [{ id: 'rule', type: 'formula', range, value: formula, style: { bold: true } }],
    validations: [{ id: 'validation', type: 'formula', range, source: formula, strict: true, allowBlank: false }],
    filter: { range: { ...range, r1: 0 }, criteria: { 0: { formula } } },
  }] }); return wb;
}
it.each(['  =A2>$B$1  ', '\t= A2>$B$1\n', '\n\t=\nA2>$B$1\t', '\u00a0= A2>$B$1\u00a0', '  A2>$B$1  '])('evaluates rule formula %j consistently', formula => {
  const wb = source(formula), id = wb.activeSheetId;
  expect(wb.validateInput(id, 2, 0, '9').ok).toBe(true); expect(wb.validateInput(id, 2, 0, '3').ok).toBe(false);
  expect(wb.validateCell(id, 2, 0).ok).toBe(true);
  expect(wb.conditionalStyle(id, 2, 0, 9)).toMatchObject({ bold: true });
  expect(wb.conditionalStyle(id, 1, 0, 3)).toBeNull();
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
  wb.setInput(id, 0, 1, '10'); wb.reapplyFilter(id); expect([...wb.sheet(id).filterHidden]).toEqual([1, 2]);
  wb.undo(); wb.reapplyFilter(id); expect([...wb.sheet(id).filterHidden]).toEqual([1]);
});
it('preserves whitespace inside string literals', () => {
  const wb = source('  =A2=" keep "  '), id = wb.activeSheetId;
  expect(wb.validateInput(id, 1, 0, ' keep ').ok).toBe(true);
  expect(wb.validateInput(id, 1, 0, 'keep').ok).toBe(false);
  expect(wb.evalRuleFormula(id, ' \t =" = keep " ', range, 1, 0)).toBe(' = keep ');
});
it.each(['   ', '\t=\n', '  ==TRUE()', '  =SUM('])('keeps malformed or empty rules invalid: %j', formula => {
  const wb = source(formula), id = wb.activeSheetId;
  expect(wb.validateInput(id, 1, 0, '9').ok).toBe(false);
  expect(wb.conditionalStyle(id, 1, 0, 9)).toBeNull();
});
it('preserves whitespace-prefixed filter formulas through a column rename across table boundaries', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 9 }, '2,0': { v: 3 } },
    tables: [{ id: 'items', name: 'Items', range: { r1: 0, c1: 0, r2: 1, c2: 0 } }],
    filter: { range: { r1: 0, c1: 0, r2: 2, c2: 0 }, criteria: { 0: { formula: '  =IFERROR([@Amount]>5,FALSE())  ' } } } }] });
  const id = wb.activeSheetId;
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  wb.setInput(id, 0, 0, 'Price'); wb.reapplyFilter(id); expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  wb.undo(); expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  wb.redo(); expect([...wb.sheet(id).filterHidden]).toEqual([2]);
});
it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('preserves custom validation with surrounding whitespace through %s reopening', async (ext, write) => {
  let wb = source('  = A2>$B$1  ');
  wb = await workbookFromFile(await write(wb), `rules.${ext}`);
  expect(wb.validateInput(wb.activeSheetId, 2, 0, '9').ok).toBe(true);
  expect(wb.validateInput(wb.activeSheetId, 2, 0, '3').ok).toBe(false);
});
it('preserves already-working list expressions with leading whitespace through ODS export', async () => {
  let wb = source('TRUE()'), id = wb.activeSheetId;
  wb.addValidation(id, { type: 'list', range: { r1: 0, c1: 3, r2: 1, c2: 3 }, source: '  =Data!A2:A3  ', strict: true });
  expect(wb.listOptionsFor(id, wb.validationAt(id, 0, 3))).toEqual(['3', '9']);
  wb = await workbookFromFile(await workbookToOds(wb), 'list.ods'); id = wb.activeSheetId;
  expect(wb.listOptionsFor(id, wb.validationAt(id, 0, 3))).toEqual(['3', '9']);
});
