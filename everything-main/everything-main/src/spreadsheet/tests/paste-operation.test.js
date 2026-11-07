import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['range', 'sheet'])('reports zero arithmetic changes when %s protection refuses the batch', (protection) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 1, 0, '20');
  if (protection === 'sheet') wb.setSheetProtected(id, true);
  else wb.protectRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.pasteOperation(id, [[1], [2]], 0, 0, 'add')).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('writes #DIV/0! where paste arithmetic divides by zero', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 1, 0, '20');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
  expect(wb.pasteOperation(id, [[0], [4]], 0, 0, 'div')).toBe(2);
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#DIV/0!' });
  expect(wb.getDisplay(id, 0, 0)).toBe('#DIV/0!');
  expect(wb.getCell(id, 0, 0).s.bold).toBe(true);
  expect(wb.getValue(id, 1, 0)).toBe(5);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(10);
});

it('counts only arithmetic results that changed a cell', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 1, 0, '20');
  wb.clearHistory();
  expect(wb.pasteOperation(id, [[1], [1]], 0, 0, 'mul')).toBe(0);
  expect(wb.canUndo()).toBe(false);
  expect(wb.pasteOperation(id, [[0], [5]], 0, 0, 'add')).toBe(1);
  expect(wb.getValue(id, 0, 0)).toBe(10);
  expect(wb.getValue(id, 1, 0)).toBe(25);
});

it.each([
  [1e300, 2, 'mul', 2e300],
  [1e-20, 2, 'div', 5e-21],
  [0.1, 0.2, 'add', 0.3],
  [Number.MAX_VALUE, 1, 'mul', Number.MAX_VALUE],
  [1234567890123456, 1, 'add', 1234567890123457],
  [Number.MIN_VALUE, 1, 'mul', Number.MIN_VALUE],
])('preserves the magnitude of %s with paste arithmetic', (initial, operand, op, expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: initial, s: { bold: true } } }]);
  wb.clearHistory();
  expect(wb.pasteOperation(id, [[operand]], 0, 0, op)).toBe(expected === initial ? 0 : 1);
  expect(wb.canUndo()).toBe(expected !== initial);
  expect(wb.getValue(id, 0, 0)).toBe(expected);
  expect(wb.getCell(id, 0, 0).s.bold).toBe(true);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(initial);
  wb.redo();
  expect(wb.getValue(id, 0, 0)).toBe(expected);
});
