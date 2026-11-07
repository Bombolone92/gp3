import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Input');
  wb.setInput(id, 0, 1, 'Result');
  wb.setInput(id, 1, 0, '2');
  const table = wb.addTable(id, parseRange('A1:B3'));
  return { wb, id, table };
}

it.each([
  ['calculated column', 'B2', 1, 1, '=A2*2'],
  ['new row', 'A4', 3, 0, '3'],
  ['new column', 'C2', 1, 2, '3'],
])('does not change a table after a protected %s edit is rejected', (_, address, r, c, input) => {
  const { wb, id } = setup();
  wb.protectRange(id, parseRange(address), 'Keep');
  const before = wb.toJSON();
  const history = wb.undoLabels();
  wb.setInput(id, r, c, input);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
});

it('still fills an editable calculated column and undoes the edit as one action', () => {
  const { wb, id, table } = setup();
  wb.protectRange(id, parseRange('D1'), 'Unrelated');
  wb.clearHistory();
  wb.setInput(id, 1, 1, '=A2*2');
  expect(wb.getValue(id, 1, 1)).toBe(4);
  expect(wb.getCell(id, 2, 1).f).toBe('A3*2');
  expect(wb.tableById(id, table).calc).toEqual({ 1: 'A2*2' });
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.getCell(id, 1, 1)).toBeUndefined();
  expect(wb.getCell(id, 2, 1)).toBeUndefined();
  wb.redo();
  expect(wb.getValue(id, 1, 1)).toBe(4);
  expect(wb.getCell(id, 2, 1).f).toBe('A3*2');
});

it('keeps literal dropdown text out of calculated columns while preserving table growth and protection', () => {
  const { wb, id, table } = setup();
  wb.clearHistory();
  wb.setInput(id, 1, 1, '=A2*2', { literal: true });
  expect(wb.getValue(id, 1, 1)).toBe('=A2*2');
  expect(wb.getValue(id, 2, 1)).toBeNull();
  expect(wb.tableById(id, table).calc || {}).toEqual({});
  wb.setInput(id, 3, 0, '=1+1', { literal: true });
  expect(wb.tableById(id, table).range.r2).toBe(3);
  expect(wb.getValue(id, 3, 0)).toBe('=1+1');
  wb.undo();
  expect(wb.tableById(id, table).range.r2).toBe(2);
  expect(wb.getValue(id, 3, 0)).toBeNull();
  wb.protectRange(id, parseRange('A4'), 'Keep');
  const before = wb.toJSON();
  const history = wb.undoLabels();
  wb.setInput(id, 3, 0, '=1+1', { literal: true });
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
});
