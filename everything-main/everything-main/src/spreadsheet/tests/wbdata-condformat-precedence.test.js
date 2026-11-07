import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { tableStyle } from '../src/core/tables.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));
const at = (wb, id, r, c) => wb.conditionalStyle(id, r, c, wb.getValue(id, r, c));

it('paints a color scale over a table\'s banded rows instead of only the unbanded ones', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt'], ['x', 0], ['y', 5], ['z', 10]]));
  wb.addTable(id, parseRange('A1:B4'), { name: 'T', banded: true });
  expect(at(wb, id, 1, 1)?.bg).toBe(tableStyle('blue').band);
  wb.addRule(id, { type: 'scale', range: parseRange('B2:B4'), from: '#000000', to: '#ffffff' });
  expect([1, 2, 3].map((r) => at(wb, id, r, 1)?.bg)).toEqual(['#000000', '#7f7f7f', '#ffffff']);
  // The band stays where no rule paints.
  expect(at(wb, id, 1, 0)?.bg).toBe(tableStyle('blue').band);
});

it('lets an earlier color scale keep its fill against a later highlight rule, which still adds its other styles', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([[0], [5], [10]]));
  wb.addRule(id, { type: 'scale', range: parseRange('A1:A3'), from: '#000000', to: '#ffffff' });
  const highlight = wb.addRule(id, { type: 'gt', range: parseRange('A1:A3'), value: 1, style: { bg: '#ff0000', bold: true } });
  expect(at(wb, id, 0, 0)).toEqual({ bg: '#000000' });
  expect(at(wb, id, 1, 0)).toEqual({ bg: '#7f7f7f', bold: true });
  expect(at(wb, id, 2, 0)).toEqual({ bg: '#ffffff', bold: true });
  // Moved above the scale, the highlight wins the cells it matches, as before.
  wb.moveRule(id, highlight, -1);
  expect(at(wb, id, 0, 0)).toEqual({ bg: '#000000' });
  expect(at(wb, id, 1, 0)).toEqual({ bg: '#ff0000', bold: true });
});
