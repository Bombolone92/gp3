import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A formula typed into an empty table column became the column's template before its fill was
// written, and one protected cell refused the fill whole (as it refuses a paste): the column was
// left half calculated, the protected cell's neighbours empty, while every row added later took
// the formula. The template is now recorded only when the fill can be written, and the protected
// cell is announced as a refused paste announces it.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Qty', 'Dbl'], [1], [2], [3]]));
  const tid = wb.addTable(id, parseRange('A1:B4'), { name: 'T' });
  const refused = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') refused.push(e.detail); });
  const column = () => [1, 2, 3, 4].map((r) => wb.getCell(id, r, 1)?.f ?? null);
  return { wb, id, tid, refused, column };
}

it('records no template while a protected cell refuses the fill, and says which cell', () => {
  const { wb, id, tid, refused, column } = book();
  const pid = wb.protectRange(id, parseRange('B3:B3'), 'Keep');
  wb.setInput(id, 1, 1, '=[@Qty]*2');
  expect(wb.tableById(id, tid).calc?.[1]).toBeUndefined();
  expect(column()).toEqual(['[@Qty]*2', null, null, null]);
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({ range: parseRange('B3:B3'), description: 'Keep' });
  // A row added later takes no formula from a column that has no template.
  expect(wb.addTableRow(id, tid)).toBe(4);
  expect(wb.getCell(id, 4, 1)).toBeUndefined();
  // Once the cell is unprotected, the formula typed into the column fills it and becomes its template.
  wb.unprotectRange(id, pid);
  wb.setInput(id, 4, 1, '=[@Qty]*2');
  expect(wb.tableById(id, tid).calc).toEqual({ 1: '[@Qty]*2' });
  expect(column()).toEqual(['[@Qty]*2', '[@Qty]*2', '[@Qty]*2', '[@Qty]*2']);
  expect([2, 3, 4].map((r) => wb.getValue(id, r, 1))).toEqual([4, 6, 0]);
  expect(refused).toHaveLength(1);
});

it('keeps the template when the protected cell already holds the formula and nothing need be written there', () => {
  const { wb, id, tid, refused, column } = book();
  wb.setInput(id, 1, 1, '=[@Qty]*2');
  expect(wb.tableById(id, tid).calc).toEqual({ 1: '[@Qty]*2' });
  wb.protectRange(id, parseRange('B3:B3'), 'Keep');
  wb.setInput(id, 3, 1, '=[@Qty]*2');
  expect(wb.tableById(id, tid).calc).toEqual({ 1: '[@Qty]*2' });
  expect(column()).toEqual(['[@Qty]*2', '[@Qty]*2', '[@Qty]*2', null]);
  expect(refused).toEqual([]);
});
