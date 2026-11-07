import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { renameColumnsInFormula } from '../src/core/tables.js';

it('renames multiple headers together without changing column identity', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 1, f: null } }, { r: 0, c: 1, cell: { v: 2, f: null } },
    { r: 1, c: 0, cell: { v: 10, f: null } }, { r: 1, c: 1, cell: { v: 20, f: null } },
  ]);
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
  wb.setInput(id, 0, 4, '=SUM(Sales[1])+10*SUM(Sales[2])');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, { fmt: 'number', dec: 2 });
  expect(wb.getValue(id, 0, 4)).toBe(210);
  // New names can also coincide with another column's old name. Apply the
  // mapping once to the original tokens rather than chaining replacements.
  const renamed = renameColumnsInFormula('Sales[One]+Sales[Two]+[@One]', 'Sales', new Map([['one', 'Two'], ['two', 'One']]), 'Sales');
  expect(renamed).toBe('Sales[Two]+Sales[One]+[@Two]');
});

it.each([
  [{}, { fmt: 'number', dec: 2 }],
  [{ fmt: 'number', dec: 2 }, { fmt: null, dec: null }],
  [{}, { fmt: 'currency' }],
  [{ fmt: 'number', dec: 2 }, 'clear'],
])('keeps structured references valid when header formatting changes from %j to %j', (initial, patch) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const other = wb.addSheet('Summary').id;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 1, f: null, s: initial } },
    { r: 0, c: 1, cell: { v: 'Double', f: null } },
    { r: 1, c: 0, cell: { v: 10, f: null } },
  ]);
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
  const oldName = wb.tableColumns(id, wb.tableById(id, table))[0];
  wb.setInput(id, 1, 1, `=[@[${oldName}]]*2`);
  wb.setInput(other, 0, 0, `=SUM(Sales[${oldName}])`);
  expect(wb.getValue(other, 0, 0)).toBe(10);
  expect(wb.getValue(id, 1, 1)).toBe(20);
  wb.clearHistory();
  const before = wb.toJSON();
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  if (patch === 'clear') wb.clearRange(id, range, { contents: false, styles: true });
  else wb.applyStyle(id, range, patch);
  expect(wb.getValue(other, 0, 0)).toBe(10);
  expect(wb.getValue(id, 1, 1)).toBe(20);
  expect(wb.undoLabels()).toEqual([patch === 'clear' ? 'Clear' : 'Format']);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.getValue(other, 0, 0)).toBe(10);
  const row = wb.addTableRow(id, table);
  wb.setInput(id, row, 0, '3');
  expect(wb.getValue(id, row, 1)).toBe(6);
});

it('leaves protected headers and their references unchanged when formatting is refused', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Sales' });
  wb.setInput(id, 0, 2, '=SUM(Sales[1])');
  wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'Header');
  wb.clearHistory();
  const before = wb.toJSON();
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency' });
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
