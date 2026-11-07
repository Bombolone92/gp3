// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
it('finds the full printable bounds of a sparsely bordered blank form', () => {
  const wb = new Workbook({ sheets: [{ name: 'Form', rows: 600, cols: 100 }] }), id = wb.activeSheetId;
  wb.applyBorders(id, { r1: 1, c1: 1, r2: 550, c2: 95 }, 'outer', { style: 'double', color: '#225599' });
  expect(wb.activeSheet.cells.size).toBe(0);
  // Keep a few physical rows/columns visible so this verifies the full extent
  // without constructing tens of thousands of irrelevant DOM nodes.
  for (let r = 1; r <= 550; r++) if (![1, 300, 550].includes(r)) wb.activeSheet.hiddenRows.add(r);
  for (let c = 1; c <= 95; c++) if (![1, 50, 95].includes(c)) wb.activeSheet.hiddenCols.add(c);
  const table = buildPrintTable(wb, id, { headers: true });
  const rows = [...table.querySelectorAll('tr')];
  expect(rows).toHaveLength(4); expect(table.querySelectorAll('col')).toHaveLength(4);
  expect(rows[0].textContent).toBe('BAYCR');
  expect(rows[1].children[1].style.borderTop).toContain('double');
  expect(rows[3].children[3].style.borderBottom).toContain('double');
});
it('prints a boxed column only through the allocated grid', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.applyBorders(id, { r1: 0, c1: 3, r2: 99, c2: 3, scope: 'columns' }, 'all');
  expect(buildPrintTable(wb, id).querySelectorAll('tr')).toHaveLength(100);
});

it('keeps boxed line forms printable and respects a finite clear at the allocated edge', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.applyBorders(id, { r1: 0, c1: 2, r2: 99, c2: 3, scope: 'columns' }, 'all');
  wb.applyBorders(id, { r1: 50, c1: 2, r2: 99, c2: 3 }, 'none');
  expect(buildPrintTable(wb, id).querySelectorAll('tr')).toHaveLength(50);
  expect(wb.styleAt(id, 100, 2).br).toBe(true);
});

it('keeps a single full-width rule from expanding print bounds on a large finite selection', () => {
  const wb = new Workbook({ sheets: [{ name: 'Rule', rows: 1000, cols: 80, cells: { '0,0': { v: 'Title' } } }] }), id = wb.activeSheetId;
  wb.applyBorders(id, { r1: 0, c1: 0, r2: 999, c2: 79 }, 'bottom');
  const table = buildPrintTable(wb, id);
  expect(table.querySelectorAll('tr')).toHaveLength(1);
  expect(table.querySelectorAll('col')).toHaveLength(1);
});
it('respects stored blank-cell masks at the last edge of a sparse finite form', () => {
  const wb = new Workbook({ sheets: [{ name: 'Form', rows: 700, cols: 120 }] }), id = wb.activeSheetId;
  wb.applyBorders(id, { r1: 1, c1: 1, r2: 600, c2: 100 }, 'all');
  wb.setCells(id, Array.from({ length: 100 }, (_, i) => ({ r: 600, c: i + 1, cell: { s: { bt: false, bb: false, bl: false, br: false } } })));
  for (let r = 1; r < 599; r++) wb.activeSheet.hiddenRows.add(r);
  const table = buildPrintTable(wb, id);
  expect(table.querySelectorAll('tr')).toHaveLength(1);
});
