import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['blank', 'duplicate', 'formula'])('refuses table creation atomically when a %s header needs a protected edit', (kind) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Name');
  if (kind === 'duplicate') wb.setInput(id, 0, 1, 'Name');
  if (kind === 'formula') wb.setInput(id, 0, 1, '="Amount"');
  wb.setInput(id, 1, 1, '10');
  wb.protectRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 2 }, { name: 'Sales', totalsRow: true })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('allows an unchanged protected header while creating names in editable columns', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Name');
  wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 });
  wb.clearHistory();
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
  expect(tid).toBeTruthy();
  expect(wb.getValue(id, 0, 0)).toBe('Name');
  expect(wb.getValue(id, 0, 1)).toBe('Column2');
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.tableById(id, tid)).toBeNull();
  expect(wb.getValue(id, 0, 1)).toBeNull();
  wb.redo();
  expect(wb.tableById(id, tid).name).toBe('Sales');
  expect(wb.getValue(id, 0, 1)).toBe('Column2');
});
