import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { columnStats } from '../src/core/stats.js';

it.each([
  [[1e308, 1e308], 1e308],
  [[-1e308, -1e308], -1e308],
  [[Number.MAX_VALUE, Number.MAX_VALUE], Number.MAX_VALUE],
  [[-Number.MAX_VALUE, Number.MAX_VALUE], 0],
  [[Number.MIN_VALUE, Number.MIN_VALUE], Number.MIN_VALUE],
  [[Number.MIN_VALUE, 2 * Number.MIN_VALUE], 2 * Number.MIN_VALUE],
  [[3, 10, 4, 7], 5.5],
])('keeps median calculations finite and correctly rounded for %j', (values, expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, values.map((v, r) => ({ r, c: 0, cell: { v } })));
  wb.setInput(id, 0, 2, `=MEDIAN(A1:A${values.length})`);
  wb.setInput(id, 1, 2, `=AGGREGATE(12,0,A1:A${values.length})`);
  expect(wb.getValue(id, 0, 2)).toBe(expected);
  expect(wb.getValue(id, 1, 2)).toBe(expected);
  expect(columnStats(wb, id, 0, { r1: 0, c1: 0, r2: values.length - 1, c2: 0 }).median).toBe(expected);
});
