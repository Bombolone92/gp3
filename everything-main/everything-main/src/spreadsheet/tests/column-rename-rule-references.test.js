import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const range = { r1: 0, c1: 0, r2: 2, c2: 1 };
function source() {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '0,1': { v: 'Limit' }, '1,0': { v: 3 }, '1,1': { v: 5 }, '2,0': { v: 9 }, '2,1': { v: 10 }, '0,3': { v: 15 } }, tables: [{ id: 'items', name: 'Items', range }] }, { name: 'Other', cells: { '0,3': { v: 15 } } }] });
  for (const s of wb.sheets) {
    wb.addValidation(s.id, { type: 'list', range: { r1: 0, c1: 2, r2: 0, c2: 2 }, source: '=Items[Amount]', strict: true });
    wb.addValidation(s.id, { type: 'formula', range: { r1: 0, c1: 3, r2: 0, c2: 3 }, source: 'D1<=MAX(Items[Amount])', strict: true });
    wb.addRule(s.id, { type: 'formula', range: { r1: 0, c1: 3, r2: 0, c2: 3 }, value: 'D1>MAX(Items[Amount])', style: { bold: true } });
  }
  wb.setFilterRange(wb.sheets[0].id, range); wb.setFilterCriteria(wb.sheets[0].id, 0, { formula: 'A2>=AVERAGE(Items[Amount])' });
  wb.clearHistory(); return wb;
}
const rename = (wb, bulk = false) => bulk ? wb.setCellsWithTableHeaders(wb.sheets[0].id, [{ r: 0, c: 0, cell: { v: 'Price' } }]) : wb.setInput(wb.sheets[0].id, 0, 0, 'Price');
it.each([false, true])('keeps explicit rule references live after header edits (bulk=%s)', bulk => {
  const wb = source(); rename(wb, bulk);
  for (const s of wb.sheets) {
    expect(s.validations[0].source).toBe('=Items[Price]');
    expect(wb.listOptionsFor(s.id, s.validations[0])).toEqual(['3', '9']);
    expect(s.validations[1].source).toBe('D1<=MAX(Items[Price])');
    expect(wb.validateInput(s.id, 0, 3, '15').ok).toBe(false);
    expect(s.rules[0].value).toBe('D1>MAX(Items[Price])');
    expect(wb.conditionalStyle(s.id, 0, 3, 15)).toMatchObject({ bold: true });
  }
  const s = wb.sheets[0]; expect(s.filter.criteria[0].formula).toBe('A2>=AVERAGE(Items[Price])');
  wb.reapplyFilter(s.id); expect([...s.filterHidden]).toEqual([1]);
  wb.setInput(s.id, 2, 0, '20'); expect(wb.validateInput(s.id, 0, 3, '15').ok).toBe(true);
});
it('renames swapped column headers simultaneously in rules', () => {
  const wb = source(), s = wb.sheets[0];
  wb.addRule(s.id, { type: 'formula', range: { r1: 1, c1: 1, r2: 2, c2: 1 }, value: 'Items[@Amount]<Items[@Limit]', style: { italic: true } });
  wb.setCellsWithTableHeaders(s.id, [{ r: 0, c: 0, cell: { v: 'Limit' } }, { r: 0, c: 1, cell: { v: 'Amount' } }]);
  expect(s.rules[1].value).toBe('Items[@Limit]<Items[@Amount]');
  expect(wb.listOptionsFor(s.id, s.validations[0])).toEqual(['3', '9']);
  expect(wb.conditionalStyle(s.id, 1, 1, 5)).toMatchObject({ italic: true });
});
it('updates unqualified references within a single table', () => {
  const wb = source(), s = wb.sheets[0];
  wb.addRule(s.id, { type: 'formula', range: { r1: 1, c1: 1, r2: 2, c2: 1 }, value: '[@Amount]<B2', style: { italic: true } });
  wb.addValidation(s.id, { type: 'formula', range: { r1: 1, c1: 1, r2: 2, c2: 1 }, source: 'B2>[@Amount]', strict: true });
  rename(wb);
  expect(s.rules[1].value).toBe('[@Price]<B2'); expect(s.validations[2].source).toBe('B2>[@Price]');
  expect(wb.validateInput(s.id, 1, 1, '5').ok).toBe(true); expect(wb.validateInput(s.id, 1, 1, '2').ok).toBe(false);
});
function spanning() {
  return new Workbook({ sheets: [{ name: 'Data', cells: {
    '0,0': { v: 'Amount' }, '0,1': { v: 'Check' }, '1,0': { v: 3 }, '1,1': { v: 5 }, '2,0': { v: 9 }, '2,1': { v: 10 },
    '0,3': { v: 'Amount' }, '0,4': { v: 'Check' }, '1,3': { v: 3 }, '1,4': { v: 5 }, '2,3': { v: 9 }, '2,4': { v: 10 },
  }, tables: [{ id: 'items', name: 'Items', range }, { id: 'other', name: 'OtherItems', range: { r1: 0, c1: 3, r2: 2, c2: 4 } }],
  rules: [{ id: 'rule', type: 'formula', range: { r1: 1, c1: 1, r2: 2, c2: 4 }, value: 'IFERROR([@Amount]<B2,FALSE())', style: { italic: true } }],
  validations: [{ id: 'validation', type: 'formula', range: { r1: 1, c1: 1, r2: 2, c2: 4 }, source: 'IFERROR(B2>[@Amount],TRUE())', strict: true }],
  }] });
}
it('preserves per-cell table context when a rule spans tables and a gap', () => {
  const wb = spanning(), s = wb.sheets[0]; rename(wb);
  for (const c of [1, 4]) {
    expect(wb.conditionalStyle(s.id, 1, c, 5)).toMatchObject({ italic: true });
    expect(wb.validateInput(s.id, 1, c, '5').ok).toBe(true);
    expect(wb.validateInput(s.id, 1, c, '2').ok).toBe(false);
    expect(wb.validateInput(s.id, 2, c, '10').ok).toBe(true);
  }
  expect(wb.conditionalStyle(s.id, 1, 2, 5)?.italic).not.toBe(true);
  expect(wb.validateInput(s.id, 1, 2, '2').ok).toBe(true);
  expect(new Set(s.rules.map(r => r.id)).size).toBe(s.rules.length);
  expect(new Set(s.validations.map(r => r.id)).size).toBe(s.validations.length);
});
it('keeps rule ordering and complete undo when splitting a spanning rule', () => {
  const wb = spanning(), s = wb.sheets[0];
  wb.addRule(s.id, { type: 'formula', range: { r1: 1, c1: 1, r2: 2, c2: 4 }, value: 'TRUE', style: { italic: false } });
  wb.clearHistory(); const before = wb.toJSON(); rename(wb); const after = wb.toJSON();
  expect(s.validations.some(v => v.source.includes('Price'))).toBe(true);
  expect(wb.conditionalStyle(s.id, 1, 1, 5)?.italic).toBe(true);
  expect(wb.conditionalStyle(s.id, 1, 2, 5)?.italic).toBe(false);
  wb.undo(); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  wb.redo(); expect(wb.toJSON()).toEqual(after); expect(wb.validateInput(s.id, 1, 4, '5').ok).toBe(true);
});
it('keeps a filter spanning vertically separated tables in its original contexts', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 3 }, '2,0': { v: 9 }, '4,0': { v: 'Amount' }, '5,0': { v: 3 }, '6,0': { v: 9 } },
    tables: [{ id: 'items', name: 'Items', range: { r1: 0, c1: 0, r2: 2, c2: 0 } }, { id: 'other', name: 'OtherItems', range: { r1: 4, c1: 0, r2: 6, c2: 0 } }],
    filter: { range: { r1: 0, c1: 0, r2: 6, c2: 0 }, criteria: { 0: { formula: 'IFERROR([@Amount]>5,FALSE())' } } } }] });
  const s = wb.sheets[0], before = [...s.filterHidden]; expect(before).toContain(1); expect(before).not.toContain(2);
  rename(wb); wb.reapplyFilter(s.id); expect([...s.filterHidden]).toEqual(before);
});
it('preserves generated references on protected dependent sheets', () => {
  const wb = source(), s = wb.sheets[1]; wb.setSheetProtected(s.id, true); rename(wb);
  expect(s.protected).toBe(true); expect(wb.listOptionsFor(s.id, s.validations[0])).toEqual(['3', '9']);
  wb.setInput(s.id, 0, 0, 'blocked'); expect(wb.getCell(s.id, 0, 0)).toBeUndefined();
});
it('preserves literal lists, strings, and unrelated table columns', () => {
  const wb = source(), s = wb.sheets[0];
  s.validations[0].source = ['Items[Amount]']; s.rules[0].value = 'AND("Amount"="Amount",SUM(Items[Amount])>0)';
  rename(wb); expect(s.validations[0].source).toEqual(['Items[Amount]']);
  expect(s.rules[0].value).toBe('AND("Amount"="Amount",SUM(Items[Price])>0)');
});
it('preserves split rule behavior through XLSX reopening', async () => {
  let wb = spanning(); rename(wb); wb = await workbookFromFile(await workbookToXlsx(wb), 'columns.xlsx');
  for (const c of [1, 4]) {
    expect(wb.validateInput(wb.activeSheetId, 1, c, '5').ok).toBe(true);
    expect(wb.conditionalStyle(wb.activeSheetId, 1, c, 5)).toMatchObject({ italic: true });
  }
});
it('handles two renamed tables within one spanning rule in the same batch', () => {
  const wb = spanning(), s = wb.sheets[0];
  wb.setCellsWithTableHeaders(s.id, [{ r: 0, c: 0, cell: { v: 'Price' } }, { r: 0, c: 3, cell: { v: 'Cost' } }]);
  for (const c of [1, 4]) {
    expect(wb.conditionalStyle(s.id, 1, c, 5)).toMatchObject({ italic: true });
    expect(wb.validateInput(s.id, 1, c, '5').ok).toBe(true);
    expect(wb.validateInput(s.id, 1, c, '2').ok).toBe(false);
  }
  expect(wb.validationAt(s.id, 1, 1).source).toContain('Price');
  expect(wb.validationAt(s.id, 1, 4).source).toContain('Cost');
});
it('splits a whole-sheet rule into bounded rectangles without visiting empty cells', () => {
  const wb = source(), s = wb.sheets[0], cells = s.cells.size;
  s.rules = [{ id: 'whole', type: 'formula', range: { r1: 0, c1: 0, r2: 19999, c2: 701 }, value: 'IFERROR([@Amount]>0,FALSE())', style: { italic: true } }];
  rename(wb);
  expect(s.rules.some(r => r.value.includes('Price'))).toBe(true);
  expect(s.rules.length).toBeLessThanOrEqual(5); expect(s.cells.size).toBe(cells);
  expect(s.rules.reduce((area, r) => area + (r.range.r2-r.range.r1+1)*(r.range.c2-r.range.c1+1), 0)).toBe(20000*702);
  expect(wb.conditionalStyle(s.id, 1, 1, 5)).toMatchObject({ italic: true });
});
it('keeps explicit formula edits independent while renaming rules at the same cell', () => {
  const wb = source(), s = wb.sheets[0];
  wb.setCellsWithTableHeaders(s.id, [{ r: 0, c: 0, cell: { v: 'Limit' } }, { r: 0, c: 1, cell: { v: 'Amount' } }, { r: 0, c: 3, cell: { f: 'SUM(Items[Limit])' } }]);
  expect(wb.getCell(s.id, 0, 3).f).toBe('SUM(Items[Limit])');
  expect(s.rules[0].value).toBe('D1>MAX(Items[Limit])');
  expect(wb.getValue(s.id, 0, 3)).toBe(12);
});
it('does not rewrite rules when protection refuses the header edit', () => {
  const wb = source(), s = wb.sheets[0]; wb.protectRange(s.id, { r1: 0, c1: 0, r2: 0, c2: 0 }); wb.clearHistory();
  const before = wb.toJSON(); rename(wb); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  rename(wb, true); expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});
