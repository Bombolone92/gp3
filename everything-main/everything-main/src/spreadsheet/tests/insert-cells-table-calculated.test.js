import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Inserting cells across a table's full width, shifting its rows down, grew the
// table without giving the new row its calculated columns, unlike inserting
// rows; the row's total stayed blank however its inputs were filled in.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => (v == null ? null : { r: r + 1, c: c + 1, cell: { v } }))).filter(Boolean);

function book(formula, { totals = false } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Qty', 'Price', 'Amount'], [2, 3, null], [4, 5, null]]));
  wb.addTable(id, parseRange('B2:D4'), { name: 'T', totalsRow: totals });
  wb.setInput(id, 2, 3, formula);
  wb.clearHistory();
  return { wb, id };
}

it('fills the calculated columns of a table row inserted by shifting cells down', () => {
  const { wb, id } = book('=[@Qty]*[@Price]');
  expect(wb.insertCells(id, parseRange('B3:D3'), 'down')).toBe(true);
  expect(wb.sheet(id).tables[0].range).toEqual(parseRange('B2:D5'));
  expect([2, 3, 4].map((r) => wb.getCell(id, r, 3)?.f)).toEqual(['[@Qty]*[@Price]', '[@Qty]*[@Price]', '[@Qty]*[@Price]']);
  wb.setInput(id, 2, 1, '10'); wb.setInput(id, 2, 2, '2');
  expect([2, 3, 4].map((r) => wb.getValue(id, r, 3))).toEqual([20, 6, 20]);
  wb.undo(); wb.undo(); wb.undo();
  expect(wb.getCell(id, 2, 3)?.f).toBe('[@Qty]*[@Price]');
  expect(wb.getCell(id, 4, 3)).toBeUndefined();
  expect(wb.sheet(id).tables[0].range).toEqual(parseRange('B2:D4'));
});

it('shifts an A1 template to the inserted row, and fills rows inserted above the totals row', () => {
  const { wb, id } = book('=B3*C3', { totals: true });
  expect(wb.insertCells(id, parseRange('B4:D5'), 'down')).toBe(true);
  expect([2, 3, 4, 5].map((r) => wb.getCell(id, r, 3)?.f)).toEqual(['B3*C3', 'B4*C4', 'B5*C5', 'B6*C6']);
  expect(wb.getCell(id, 6, 2)?.f).toMatch(/SUBTOTAL/);
});

it('leaves a shifted header row, and cells outside the table, without calculated columns', () => {
  const { wb, id } = book('=[@Qty]*[@Price]');
  expect(wb.insertCells(id, parseRange('B2:D2'), 'down')).toBe(true);
  expect(wb.sheet(id).tables[0].range).toEqual(parseRange('B3:D5'));
  expect(wb.getCell(id, 1, 3)).toBeUndefined();
  expect(wb.insertCells(id, parseRange('F3:F3'), 'down')).toBe(true);
  expect(wb.getCell(id, 2, 5)).toBeUndefined();
});
