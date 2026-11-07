import { expect, it, vi } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { hasSubtotals, removeSubtotals } from '../src/core/subtotal.js';

it.each(['detect', 'remove'])('does not scan millions of empty cells to %s subtotals', (action) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Header');
  const before = wb.toJSON();
  const history = wb.undoLabels();
  const getCell = wb.getCell.bind(wb);
  let reads = 0;
  vi.spyOn(wb, 'getCell').mockImplementation((...args) => {
    if (++reads > 100) throw new Error('Scanning empty cells blocks the UI');
    return getCell(...args);
  });
  const range = { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 };
  expect(action === 'detect' ? hasSubtotals(wb, id, range) : removeSubtotals(wb, id, range)).toBe(action === 'detect' ? false : 0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
});

it('removes each matching row once in row order regardless of cell insertion order', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 5, 1, '=SUBTOTAL(9,B2:B5)');
  wb.setInput(id, 5, 0, 'Grand Total');
  wb.setInput(id, 0, 0, 'Header');
  wb.setInput(id, 1, 0, 'First');
  wb.setInput(id, 3, 0, 'Second');
  wb.setInput(id, 6, 0, 'Keep below');
  wb.setInput(id, 2, 1, '=SUBTOTAL(9,B2)');
  wb.setInput(id, 2, 2, '=SUBTOTAL(9,C2)');
  wb.setInput(id, 2, 0, 'First Total');
  wb.setInput(id, 4, 3, '=SUBTOTAL(9,D2:D4)'); // outside selected columns
  wb.groupLines(id, 'row', 1, 5);
  const before = wb.toJSON();
  expect(hasSubtotals(wb, id, parseRange('A1:A7'))).toBe(false);
  expect(hasSubtotals(wb, id, parseRange('C6:A2'))).toBe(true);
  expect(removeSubtotals(wb, id, parseRange('C6:A2'))).toBe(2);
  expect(wb.getValue(id, 1, 0)).toBe('First');
  expect(wb.getValue(id, 2, 0)).toBe('Second');
  expect(wb.getValue(id, 4, 0)).toBe('Keep below');
  expect(wb.getCell(id, 3, 3).f).toBe('SUBTOTAL(9,D2:D3)');
  expect(wb.outlineGroups(id, 'row')).toHaveLength(0);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.getValue(id, 4, 0)).toBe('Keep below');
});
