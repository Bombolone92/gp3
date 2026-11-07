import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPivot } from '../src/core/pivot.js';

// Labels taken from a date column were written as plain serials (45296), not as dates.
it('keeps the source field\'s number format on row and column labels', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;
  wb.setInput(id, 0, 0, 'Date'); wb.setInput(id, 0, 1, 'Region'); wb.setInput(id, 0, 2, 'Amount');
  const rows = [[day(2024, 1, 5), 'East', 10], [day(2024, 2, 7), 'West', 20], [day(2024, 1, 5), 'West', 5]];
  rows.forEach(([d, region, amount], i) => {
    wb.setCells(id, [{ r: i + 1, c: 0, cell: { v: d, s: { fmt: 'date' } } }]);
    wb.setInput(id, i + 1, 1, region);
    wb.setInput(id, i + 1, 2, String(amount));
  });
  const range = { r1: 0, c1: 0, r2: 3, c2: 2 };
  const byDate = buildPivot(wb, id, { range, rowField: 0, colField: null, valueField: 2, agg: 'sum' });
  const labels = byDate.cells.filter(({ r, c, cell }) => c === 0 && r > 0 && typeof cell.v === 'number');
  expect(labels.length).toBe(2);
  for (const { cell } of labels) expect(cell.s).toMatchObject({ fmt: 'date' });
  const crossed = buildPivot(wb, id, { range, rowField: 1, colField: 0, valueField: 2, agg: 'sum' });
  const heads = crossed.cells.filter(({ r, c, cell }) => r === 0 && c >= 1 && typeof cell.v === 'number');
  expect(heads.length).toBe(2);
  for (const { cell } of heads) expect(cell.s).toMatchObject({ fmt: 'date', align: 'right' });
  // Text labels carry no format.
  const textLabels = crossed.cells.filter(({ r, c }) => c === 0 && r > 0);
  expect(textLabels.every(({ cell }) => !cell.s?.fmt)).toBe(true);
});
