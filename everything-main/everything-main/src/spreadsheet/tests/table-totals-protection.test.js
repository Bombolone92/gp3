import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup(on) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount'], ['A', 10]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'Sales' });
  if (!on) wb.setTableTotals(id, tid, true);
  wb.protectRange(id, { r1: 2, c1: 1, r2: 2, c2: 1 }, 'Reserved');
  wb.clearHistory();
  return { wb, id, tid };
}

it.each([true, false])('does not partially toggle a protected totals row (on: %s)', (on) => {
  const { wb, id, tid } = setup(on);
  const before = wb.toJSON();
  wb.setTableTotals(id, tid, on);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it.each([true, false])('refuses a combined table edit when its totals change is protected (on: %s)', (on) => {
  const { wb, id, tid } = setup(on);
  const before = wb.toJSON();
  expect(wb.updateTable(id, tid, { name: 'Renamed', style: 'green', totalsRow: on })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('refuses table creation with protected totals before writing headers or table metadata', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 1, 0, '10');
  wb.protectRange(id, { r1: 2, c1: 0, r2: 2, c2: 0 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { totalsRow: true })).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
