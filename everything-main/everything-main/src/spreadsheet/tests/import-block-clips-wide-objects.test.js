// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { placeImport } from '../src/ui/importdialog.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// A merged title is wider than the data under it, and a dropdown or a colour rule is applied
// down a whole column: both reach past the source's used range, which is measured from its
// filled cells alone. Appending or placing at a cell dropped them although the dialog says they
// arrive; they now come along clipped to the block.

it('carries a title merged wider than its data, clipped to the block', () => {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const src = other.activeSheetId;
  other.setInput(src, 0, 0, 'Quarterly report');
  other.mergeCells(src, parseRange('A1:F1'));
  [['a', 'b', 'c'], ['d', 'e', 'f']].forEach((row, r) => row.forEach((v, c) => other.setInput(src, r + 1, c, v)));
  expect(other.usedRange(src)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  expect(placeImport(wb, id, other, { mode: 'append', otherSheetId: src, at: { r: 0, c: 0 } })).toBeTruthy();
  expect(wb.sheet(id).merges).toEqual([{ r1: 1, c1: 0, r2: 1, c2: 2 }]);
  expect(wb.getValue(id, 1, 0)).toBe('Quarterly report');
});

it('carries a validation and a rule applied past the last filled row, clipped to the block', () => {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const src = other.activeSheetId;
  other.setInput(src, 0, 0, 'Head');
  other.setInput(src, 1, 0, 'x');
  other.addValidation(src, { range: parseRange('A1:B21'), type: 'list', source: ['x', 'y'] });
  other.addRule(src, { range: parseRange('A1:B21'), type: 'gt', value: 5, style: { bg: '#ffeeaa' } });
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  expect(placeImport(wb, id, other, { mode: 'append', otherSheetId: src, at: { r: 0, c: 0 } })).toBeTruthy();
  const sheet = wb.sheet(id);
  expect(sheet.validations.map((v) => v.range)).toEqual([{ r1: 1, c1: 0, r2: 2, c2: 0 }]);
  expect(sheet.rules.map((r) => r.range)).toEqual([{ r1: 1, c1: 0, r2: 2, c2: 0 }]);
  expect(wb.listOptionsFor(id, sheet.validations[0])).toEqual(['x', 'y']);
  // One undo step takes the clipped groups back with the cells.
  wb.undo();
  expect(wb.sheet(id).validations).toEqual([]);
  expect(wb.sheet(id).rules).toEqual([]);
});

it('keeps a rule formula reading from its own first cell when the rule started before the block', () => {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const src = other.activeSheetId;
  other.setInput(src, 1, 1, '9');
  other.setInput(src, 2, 2, '3');
  other.addRule(src, { range: parseRange('A1:C3'), type: 'formula', value: '=A1>5', style: { bold: true } });
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(placeImport(wb, id, other, { mode: 'cell', otherSheetId: src, at: { r: 0, c: 0 } })).toBeTruthy();
  const [rule] = wb.sheet(id).rules;
  expect(rule.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  expect(rule.value).toBe('=A1>5');
  expect(wb.conditionalStyle(id, 0, 0, 9)).toMatchObject({ bold: true });
});

it('still leaves behind what does not reach the block, and drops a merge clipped to one cell', () => {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const src = other.activeSheetId;
  other.setInput(src, 0, 0, 'a');
  other.setInput(src, 1, 0, 'b');
  other.mergeCells(src, parseRange('E9:F9'));
  other.mergeCells(src, parseRange('A2:B2'));
  other.addRule(src, { range: parseRange('E9:F9'), type: 'gt', value: 1, style: { bg: '#ffeeaa' } });
  const wb = new Workbook();
  const id = wb.activeSheetId;
  expect(placeImport(wb, id, other, { mode: 'cell', otherSheetId: src, at: { r: 0, c: 0 } })).toBeTruthy();
  // A2:B2 clips to the single cell A2, which is no merge; E9:F9 never touches the block.
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.sheet(id).rules).toEqual([]);
});
