import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

/** A1 spills 1, 2, 3 down to A3; F6 holds text that a refused move must leave alone. */
function spilled() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3)');
  wb.setInput(id, 5, 5, 'keep');
  expect(wb.getValue(id, 2, 0)).toBe(3);
  wb.clearHistory();
  return { wb, id, before: wb.toJSON() };
}

it('declines to move part of a spilled array by cut and paste, so the caller copies it instead of duplicating it', () => {
  const { wb, id, before } = spilled();
  const cells = wb.copyRange(id, parseRange('A2:A3'));
  expect(wb.placeMoved(id, 0, 2, cells, { sheetId: id, range: parseRange('A2:A3') })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  // The whole array, anchor included, still moves.
  const all = wb.copyRange(id, parseRange('A1:A3'));
  expect(wb.placeMoved(id, 0, 2, all, { sheetId: id, range: parseRange('A1:A3') })).toEqual(parseRange('C1:C3'));
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 2, 2), wb.getValue(id, 0, 0)]).toEqual([1, 3, null]);
  expect(wb.undoLabels()).toEqual(['Move cells']);
});

it('refuses to drag part of a spilled array, leaving the destination as it was', () => {
  const { wb, id, before } = spilled();
  expect(wb.moveRange(id, parseRange('A2:A3'), 5, 5)).toBeNull();
  expect(wb.getValue(id, 5, 5)).toBe('keep');
  expect(wb.toJSON()).toEqual(before);
  expect(wb.moveRange(id, parseRange('A1:A3'), 0, 2)).toEqual(parseRange('C1:C3'));
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 2, 2), wb.getValue(id, 0, 0)]).toEqual([1, 3, null]);
});
