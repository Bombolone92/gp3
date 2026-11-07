import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

it.each([
  { r1: -1, c1: 0, r2: 1, c2: 0 },
  { r1: 0, c1: -1, r2: 1, c2: 0 },
  { r1: MAX_ROW, c1: 0, r2: MAX_ROW + 1, c2: 0 },
  { r1: 0, c1: MAX_COL + 1, r2: 1, c2: MAX_COL + 1 },
  { r1: 0, c1: 0, r2: Infinity, c2: 0 },
  { r1: 0, c1: 0, r2: 1.5, c2: 0 },
])('refuses an invalid table range before creating headers or metadata: %j', (range) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const before = wb.toJSON();
  expect(wb.addTable(id, range)).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it.each([
  { r1: 0, c1: 0, r2: MAX_ROW + 1, c2: 1 },
  { r1: 0, c1: 0, r2: 2, c2: MAX_COL + 1 },
])('refuses resizing outside the file format grid: %j', (range) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.resizeTable(id, tid, range)).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('refuses adding data or totals past the last row without partially changing table options', () => {
  const wb = new Workbook({ sheets: [{ name: 'Edge', rows: MAX_ROW + 1 }] });
  const id = wb.activeSheetId;
  const range = { r1: MAX_ROW - 1, c1: 0, r2: MAX_ROW, c2: 0 };
  const beforeCreate = wb.toJSON();
  expect(wb.addTable(id, range, { totalsRow: true })).toBeNull();
  expect(wb.toJSON()).toEqual(beforeCreate);
  const tid = wb.addTable(id, range, { name: 'EdgeTable' });
  expect(tid).toBeTruthy();
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.addTableRow(id, tid)).toBe(-1);
  wb.setTableTotals(id, tid, true);
  expect(wb.updateTable(id, tid, { name: 'Changed', style: 'green', totalsRow: true })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
