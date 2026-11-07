import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book({ totals = false } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Qty', 'Price', 'Amount'], [2, 3, null], [4, 5, null]]));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'T', totalsRow: totals });
  wb.setInput(id, 1, 2, '=[@Qty]*[@Price]');
  wb.clearHistory();
  return { wb, id, tid };
}

it('fills the calculated columns of rows inserted between a table\'s data rows', () => {
  const { wb, id } = book();
  wb.insertRows(id, 2, 2);
  expect(wb.getCell(id, 2, 2)?.f).toBe('[@Qty]*[@Price]');
  expect(wb.getCell(id, 3, 2)?.f).toBe('[@Qty]*[@Price]');
  expect(wb.getCell(id, 4, 2)?.f).toBe('[@Qty]*[@Price]');
  wb.setInput(id, 2, 0, '10'); wb.setInput(id, 2, 1, '2');
  expect(wb.getValue(id, 2, 2)).toBe(20);
  expect(wb.getValue(id, 4, 2)).toBe(20);
  wb.undo();
  wb.undo();
  wb.undo();
  expect(wb.getCell(id, 2, 2)?.f).toBe('[@Qty]*[@Price]');
  expect(wb.getCell(id, 3, 2)).toBeUndefined();
  expect(wb.tableById(id, wb.sheet(id).tables[0].id).range.r2).toBe(2);
});

it('fills a row inserted as the first data row with A1 templates shifted to it', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Qty', 'Price', 'Amount'], [2, 3, null], [4, 5, null]]));
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, { name: 'T' });
  wb.setInput(id, 1, 2, '=A2*B2');
  wb.insertRows(id, 1, 1);
  expect(wb.getCell(id, 1, 2)?.f).toBe('A2*B2');
  expect(wb.getCell(id, 2, 2)?.f).toBe('A3*B3');
  expect(wb.getCell(id, 3, 2)?.f).toBe('A4*B4');
  wb.setInput(id, 1, 0, '7'); wb.setInput(id, 1, 1, '3');
  expect(wb.getValue(id, 1, 2)).toBe(21);
});

it('fills a row inserted above the totals row but not rows inserted outside the data', () => {
  const { wb, id } = book({ totals: true });
  wb.insertRows(id, 3, 1);
  expect(wb.getCell(id, 3, 2)?.f).toBe('[@Qty]*[@Price]');
  expect(wb.getCell(id, 4, 1)?.f).toBe('SUBTOTAL(109,T[Price])');
  wb.insertRows(id, 0, 1);
  expect(wb.getCell(id, 0, 2)).toBeUndefined();
  wb.insertRows(id, 6, 1);
  expect(wb.getCell(id, 6, 2)).toBeUndefined();
});

it('leaves rows inserted right under a table without a totals row out of it', () => {
  const { wb, id } = book();
  wb.insertRows(id, 3, 1);
  expect(wb.tableById(id, wb.sheet(id).tables[0].id).range.r2).toBe(2);
  expect(wb.getCell(id, 3, 2)).toBeUndefined();
});
