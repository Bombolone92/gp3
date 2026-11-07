import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup(formula = '=C4*D4') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Price', 'Amount'], [2, 4, null], [3, 5, null]].flatMap((row, r) => row.map((v, c) => ({ r: r + 2, c: c + 2, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 2, c1: 2, r2: 4, c2: 4 }, { name: 'Sales' });
  wb.setInput(id, 3, 4, formula);
  const summary = wb.addSheet('Summary').id;
  wb.setInput(summary, 0, 0, '=SUM(Sales[Amount])');
  expect(wb.getValue(summary, 0, 0)).toBe(23);
  wb.clearHistory();
  return { wb, id, tid, summary };
}

it.each([
  ['Rows', 2, 3, 9, { r1: 6, c1: 2, r2: 8, c2: 4 }],
  ['Rows', 2, 3, 0, { r1: 0, c1: 2, r2: 2, c2: 4 }],
  ['Rows', 0, 1, 7, { r1: 1, c1: 2, r2: 3, c2: 4 }],
  ['Cols', 2, 3, 9, { r1: 2, c1: 6, r2: 4, c2: 8 }],
  ['Cols', 2, 3, 0, { r1: 2, c1: 0, r2: 4, c2: 2 }],
  ['Cols', 0, 1, 7, { r1: 2, c1: 1, r2: 4, c2: 3 }],
  ['Cols', 4, 1, 2, { r1: 2, c1: 2, r2: 4, c2: 4 }],
  ['Rows', 3, 1, 5, { r1: 2, c1: 2, r2: 4, c2: 4 }],
])('moving %s from %i (%i) to %i keeps table formulas and new rows working', (axis, from, count, to, expected) => {
  const { wb, id, tid, summary } = setup();
  const before = wb.toJSON();
  expect(wb[`move${axis}`](id, from, count, to)).not.toBeNull();
  expect(wb.tableById(id, tid).range).toEqual(expected);
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toContain('Amount');
  expect(wb.getValue(summary, 0, 0)).toBe(23);
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
  const row = wb.addTableRow(id, tid);
  const cols = wb.tableColumns(id, wb.tableById(id, tid));
  wb.setInput(id, row, expected.c1 + cols.indexOf('Qty'), '4');
  wb.setInput(id, row, expected.c1 + cols.indexOf('Price'), '6');
  expect(wb.getValue(id, row, expected.c1 + cols.indexOf('Amount'))).toBe(24);
  expect(wb.getValue(summary, 0, 0)).toBe(47);
});

it.each([
  ['Rows', 3, 1, 8],
  ['Rows', 2, 1, 5],
  ['Rows', 4, 1, 2],
  ['Cols', 3, 1, 8],
  ['Cols', 0, 1, 3],
])('refuses moving %s from %i (%i) to %i when it breaks the table shape or header', (axis, from, count, to) => {
  const { wb, id, summary } = setup();
  const before = wb.toJSON();
  expect(wb[`move${axis}`](id, from, count, to)).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(wb.getValue(summary, 0, 0)).toBe(23);
});

it('keeps totals at the bottom while allowing data rows to be reordered', () => {
  const { wb, id, tid, summary } = setup('=[@Qty]*[@Price]');
  wb.setTableTotals(id, tid, true);
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.moveRows(id, 5, 1, 3)).toBeNull();
  expect(wb.moveRows(id, 4, 1, 6)).toBeNull();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(wb.moveRows(id, 3, 1, 5)).toBe(4);
  expect(wb.getValue(id, 5, 4)).toBe(23);
  expect(wb.getValue(summary, 0, 0)).toBe(23);
});

it('updates templates on other sheets referencing moved cells', () => {
  const { wb, id, summary } = setup();
  wb.setInput(summary, 2, 1, 'Other');
  const other = wb.addTable(summary, { r1: 2, c1: 1, r2: 3, c2: 1 });
  wb.setInput(summary, 3, 1, '=Sheet1!$E$4');
  wb.moveRows(id, 2, 3, 9);
  expect(wb.getValue(summary, 3, 1)).toBe(8);
  const row = wb.addTableRow(summary, other);
  expect(wb.getValue(summary, row, 1)).toBe(8);
});
