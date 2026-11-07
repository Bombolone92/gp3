import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Qty'], ['a', 1]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: 'T' });
  return { wb, id, tid };
}

it('does not grow a table over a merged footer typed into under it', () => {
  const { wb, id, tid } = book();
  wb.mergeCells(id, { r1: 2, c1: 0, r2: 2, c2: 1 });
  wb.setInput(id, 2, 0, 'Footer note');
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  expect(wb.getValue(id, 2, 0)).toBe('Footer note');
  expect(wb.sheet(id).merges).toEqual([{ r1: 2, c1: 0, r2: 2, c2: 1 }]);
});

it('refuses a resize that would take in merged cells, and says why', () => {
  const { wb, id, tid } = book();
  wb.mergeCells(id, { r1: 3, c1: 1, r2: 3, c2: 2 });
  wb.clearHistory();
  const before = wb.toJSON();
  const errors = [];
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 3, c2: 1 }, { onInvalid: (message) => errors.push(message) })).toBe(false);
  expect(errors).toEqual([expect.stringMatching(/merged/i)]);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('does not take a merged block into the table when a pasted block lands under it', () => {
  const { wb, id, tid } = book();
  wb.mergeCells(id, { r1: 2, c1: 0, r2: 3, c2: 0 });
  expect(wb.extendTableToCover(id, { r1: 2, c1: 0, r2: 3, c2: 1 })).toBe(false);
  expect(wb.tableById(id, tid).range.r2).toBe(1);
});

it('makes room for a new row or a totals row above a merged block instead of absorbing it', () => {
  const { wb, id, tid } = book();
  wb.mergeCells(id, { r1: 2, c1: 0, r2: 2, c2: 1 });
  wb.setInput(id, 2, 0, 'Footer');
  expect(wb.addTableRow(id, tid)).toBe(2);
  expect(wb.tableById(id, tid).range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
  expect(wb.sheet(id).merges).toEqual([{ r1: 3, c1: 0, r2: 3, c2: 1 }]);
  expect(wb.getValue(id, 3, 0)).toBe('Footer');
  wb.setTableTotals(id, tid, true);
  expect(wb.tableById(id, tid).range.r2).toBe(3);
  expect(wb.getValue(id, 3, 0)).toBe('Total');
  expect(wb.sheet(id).merges).toEqual([{ r1: 4, c1: 0, r2: 4, c2: 1 }]);
  expect(wb.getValue(id, 4, 0)).toBe('Footer');
});

it('makes room above an empty merged block too', () => {
  const { wb, id, tid } = book();
  wb.mergeCells(id, { r1: 2, c1: 0, r2: 2, c2: 1 });
  expect(wb.addTableRow(id, tid)).toBe(2);
  expect(wb.sheet(id).merges).toEqual([{ r1: 3, c1: 0, r2: 3, c2: 1 }]);
});
