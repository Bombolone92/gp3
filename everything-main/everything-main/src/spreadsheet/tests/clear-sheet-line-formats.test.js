import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book() {
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: 20000, cols: 26,
    colStyles: { 1: { bg: '#ffff00', fmt: 'currency' } },
    rowStyles: { 5: { bold: true }, 19999: { italic: true } },
    cells: { '5,1': { v: 12, f: null }, '6,1': { v: null, f: 'B6*2' } },
  }] });
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 19999, c2: 25 };
  return { wb, id, range };
}

it.each([false, true])('clears row and column defaults together for the whole sheet (contents: %s)', (contents) => {
  const { wb, id, range } = book();
  wb.clearRange(id, range, { contents, styles: true });
  expect(wb.sheet(id).colStyles.size).toBe(0);
  expect(wb.sheet(id).rowStyles.size).toBe(0);
  expect(wb.styleAt(id, 5, 1)).toBeUndefined();
  expect(wb.styleAt(id, 19999, 25)).toBeUndefined();
  expect(wb.getValue(id, 5, 1)).toBe(contents ? null : 12);
  expect(wb.getValue(id, 6, 1)).toBe(contents ? null : 24);
  expect(wb.sheet(id).cells.size).toBe(contents ? 0 : 2);
  wb.undo();
  expect(wb.styleAt(id, 5, 1)).toMatchObject({ bg: '#ffff00', fmt: 'currency', bold: true });
  expect(wb.styleAt(id, 19999, 25)).toMatchObject({ italic: true });
  expect(wb.getValue(id, 6, 1)).toBe(24);
  expect(wb.canUndo()).toBe(false);
  wb.redo();
  expect(wb.sheet(id).rowStyles.size).toBe(0);
  expect(wb.sheet(id).colStyles.size).toBe(0);
});

it('keeps other rows and columns formatted when only one column is cleared', () => {
  const { wb, id, range } = book();
  wb.clearRange(id, { ...range, c1: 1, c2: 1 }, { contents: false, styles: true });
  expect(wb.sheet(id).colStyles.size).toBe(0);
  expect(wb.styleAt(id, 5, 2)).toEqual({ bold: true });
  expect(wb.styleAt(id, 19999, 25)).toEqual({ italic: true });
});

it('keeps all defaults when sheet protection refuses clearing formats', () => {
  const { wb, id, range } = book();
  wb.setSheetProtected(id, true);
  wb.clearRange(id, range, { contents: false, styles: true });
  expect(wb.sheet(id).colStyles.size).toBe(1);
  expect(wb.sheet(id).rowStyles.size).toBe(2);
  expect(wb.getValue(id, 5, 1)).toBe(12);
});
