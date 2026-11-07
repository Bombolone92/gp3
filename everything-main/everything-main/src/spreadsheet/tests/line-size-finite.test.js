import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A column width or row height that was not a number was rounded to NaN and
// stored, with an undo step for it, leaving a line the grid could not size.
// A size that is not a finite number now changes nothing.
it('ignores a column width or row height that is not a finite number', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const bad of [NaN, undefined, null, Infinity, -Infinity, 'wide']) {
    wb.setColWidth(id, 2, bad);
    wb.setRowHeight(id, 1, bad);
  }
  expect([...wb.sheet(id).colWidths]).toEqual([]);
  expect([...wb.sheet(id).rowHeights]).toEqual([]);
  expect(wb.canUndo()).toBe(false);
  wb.setColWidth(id, 2, 150.4);
  wb.setRowHeight(id, 1, 30.6);
  expect(wb.sheet(id).colWidths.get(2)).toBe(150);
  expect(wb.sheet(id).rowHeights.get(1)).toBe(31);
  wb.setColWidth(id, 2, NaN);
  expect(wb.sheet(id).colWidths.get(2)).toBe(150);
  expect(wb.undoLabel()).toBe('Resize row');
});
