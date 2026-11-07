import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

it.each([
  ['down', 'A100', 'A103', 99, 0],
  ['right', 'Z1', 'AC1', 0, 25],
])('does not grow the sheet or report a fill when a %s series hits protection', (direction, start, protectedCell, r, c) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, r, c, '1');
  wb.protectRange(id, parseRange(protectedCell), 'Keep');
  const before = wb.toJSON();
  const history = wb.undoLabels();
  const count = wb.fillSeries(id, parseRange(start), { direction, step: 1, stop: 5 });
  expect(count).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.undoLabels()).toEqual(history);
});

it('still grows a successful single-cell series and undoes its values in one step', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 99, 0, '1');
  expect(wb.fillSeries(id, parseRange('A100'), { step: 1, stop: 5 })).toBe(4);
  expect(wb.sheet(id).rows).toBe(104);
  expect(wb.getValue(id, 103, 0)).toBe(5);
  wb.undo();
  expect(wb.getValue(id, 100, 0)).toBeNull();
  expect(wb.getValue(id, 103, 0)).toBeNull();
  expect(wb.getValue(id, 99, 0)).toBe(1);
  wb.redo();
  expect(wb.getValue(id, 103, 0)).toBe(5);
});

it('keeps the full destination span when some generated cells already match', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '2');
  expect(wb.fillSeries(id, parseRange('A1:A4'))).toBe(3);
  expect(wb.getValue(id, 3, 0)).toBe(4);
  wb.undo();
  expect(wb.getValue(id, 1, 0)).toBe(2);
  expect(wb.getValue(id, 3, 0)).toBeNull();
});
