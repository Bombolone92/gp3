import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { buildPivot } from '../src/core/pivot.js';

function setup(colField = null, filters = []) {
  const wb = new Workbook({ sheets: [{ name: 'Data' }] });
  const id = wb.activeSheetId;
  const rows = [
    ['Region', 'Quarter', 'Amount', 'Channel'],
    ['East', 'Q1', '10', 'Retail'],
    ['East', 'Q1', '', 'Retail'],
    ['East', 'Q2', '=""', 'Retail'],
    ['East', 'Q2', '0', 'Retail'],
    ['West', 'Q1', 'text', 'Retail'],
    ['West', 'Q2', 'FALSE', 'Retail'],
    ['West', 'Q2', '=1/0', 'Retail'],
  ];
  rows.forEach((row, r) => row.forEach((value, c) => wb.setInput(id, r, c, value)));
  const built = buildPivot(wb, id, { range: parseRange('A1:D8'), rowField: 0, colField, valueField: 2, agg: 'count', filters });
  const pivot = wb.addSheet('Pivot');
  wb.setCells(pivot.id, built.cells, 'Pivot');
  const at = (a1) => { const { r, c } = parseCellRef(a1); return wb.getValue(pivot.id, r, c); };
  return { wb, id, pivot, at };
}

it('counts populated value cells consistently in categories and the grand total', () => {
  const { wb, id, at } = setup();
  expect(at('B1')).toBe('Count of Amount');
  expect([at('B2'), at('B3'), at('B4')]).toEqual([2, 3, 5]);
  wb.setInput(id, 2, 2, '20');
  expect([at('B2'), at('B4')]).toEqual([3, 6]);
  wb.undo();
  expect([at('B2'), at('B4')]).toEqual([2, 5]);
});

it('excludes blank value cells from crossed counts and row and column totals', () => {
  const { at } = setup(1);
  expect([at('B2'), at('C2'), at('D2')]).toEqual([1, 1, 2]);
  expect([at('B3'), at('C3'), at('D3')]).toEqual([1, 2, 3]);
  expect([at('B4'), at('C4'), at('D4')]).toEqual([2, 3, 5]);
});

it('uses the same value-cell count with live report filters', () => {
  const { wb, pivot, at } = setup(null, [{ field: 3, value: 'Retail' }]);
  expect([at('B4'), at('B5'), at('B6')]).toEqual([2, 3, 5]);
  wb.setInput(pivot.id, 0, 1, '(All)');
  expect([at('B4'), at('B5'), at('B6')]).toEqual([2, 3, 5]);
});
