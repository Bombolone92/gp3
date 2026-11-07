import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { formatValue } from '../src/core/format.js';
import { buildPivot } from '../src/core/pivot.js';

const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;

// The label column was sized to the labels' raw values (45296.5 for a date with
// a time), not to the dates the pivot writes, so those labels were cut off.
it('fits the label column to the row labels as they are written', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const stamps = [day(2024, 1, 5) + 0.5, day(2024, 2, 7) + 0.25];
  wb.setInput(id, 0, 0, 'When'); wb.setInput(id, 0, 1, 'Amount');
  stamps.forEach((v, i) => {
    wb.setCells(id, [{ r: i + 1, c: 0, cell: { v, s: { fmt: 'datetime' } } }]);
    wb.setInput(id, i + 1, 1, String(10 * (i + 1)));
  });
  const built = buildPivot(wb, id, { range: { r1: 0, c1: 0, r2: 2, c2: 1 }, rowField: 0, colField: null, valueField: 1, agg: 'sum' });
  const shown = stamps.map((v) => formatValue(v, { fmt: 'datetime' }));
  expect(shown[0].length).toBeGreaterThan(String(stamps[0]).length);
  expect(built.widths[0]).toBe(Math.max(...shown.map((text) => text.length * 8 + 24)));
  expect(built.widths[0]).toBeGreaterThan(120);
});
