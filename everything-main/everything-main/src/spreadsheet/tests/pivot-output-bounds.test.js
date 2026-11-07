import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { buildPivot } from '../src/core/pivot.js';

function source(count, distinctRows = false) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    ...['Region', 'Category', 'Amount'].map((v, c) => ({ r: 0, c, cell: { v } })),
    ...Array.from({ length: count }, (_, i) => [
      { r: i + 1, c: 0, cell: { v: distinctRows ? `Region ${i}` : 'East' } },
      { r: i + 1, c: 1, cell: { v: `Category ${i}` } },
      { r: i + 1, c: 2, cell: { v: 1 } },
    ]).flat(),
  ]);
  const spec = { range: { r1: 0, c1: 0, r2: count, c2: 2 }, rowField: 0, colField: distinctRows ? null : 1, valueField: 2, agg: 'sum' };
  return { wb, id, spec };
}

it('rejects a pivot whose categories and total exceed the sheet column limit', () => {
  const { wb, id, spec } = source(MAX_COLS - 1);
  expect(() => buildPivot(wb, id, spec)).toThrow(/columns/i);
  expect(wb.sheets).toHaveLength(1);
});

it('includes headers and totals when checking the output row limit', () => {
  const { wb, id, spec } = source(MAX_ROWS - 1, true);
  expect(() => buildPivot(wb, id, spec)).toThrow(/rows/i);
  expect(wb.sheets).toHaveLength(1);
});

it('still builds a pivot that fits exactly within the column limit', () => {
  const { wb, id, spec } = source(MAX_COLS - 2);
  const built = buildPivot(wb, id, spec);
  expect(built.cols).toBe(MAX_COLS);
  expect(Math.max(...built.cells.map(({ c }) => c))).toBe(MAX_COLS - 1);
});
