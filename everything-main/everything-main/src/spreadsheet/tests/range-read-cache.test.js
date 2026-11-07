import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Every formula naming the same range rebuilt its array: 5,000 rows of =A2/SUM(A:A) took 20 s.
// The cap is three times a quiet run so a shared machine does not fail it; the regression it guards was 20 s.
it('shares one read of a range between the formulas that name it', { timeout: 60000 }, () => {
  const rows = 4000;
  const cells = {};
  for (let r = 0; r < rows; r++) { cells[`${r},0`] = { v: r + 1 }; cells[`${r},1`] = { f: `A${r + 1}/SUM(A:A)` }; }
  const wb = new Workbook({ sheets: [{ name: 'S', rows: rows + 5, cols: 3, cells }] });
  const id = wb.activeSheetId;
  const total = (rows * (rows + 1)) / 2;
  const t0 = performance.now();
  let sum = 0;
  for (let r = 0; r < rows; r++) sum += wb.getValue(id, r, 1);
  expect(performance.now() - t0).toBeLessThan(18000);
  expect(sum).toBeCloseTo(1, 9);
  expect(wb.getValue(id, 9, 1)).toBeCloseTo(10 / total, 12);
  // An edit is seen by every dependent, and the cache is not stale.
  wb.setInput(id, 0, 0, '1001');
  expect(wb.getValue(id, 9, 1)).toBeCloseTo(10 / (total + 1000), 12);
});

it('does not keep an array that held a cell still being calculated', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SUM(B1:B3)');
  wb.setInput(id, 0, 1, '=A1');
  wb.setInput(id, 1, 1, '2');
  wb.setInput(id, 2, 1, '3');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#CYCLE!' });
  wb.setInput(id, 0, 1, '1');
  expect(wb.getValue(id, 0, 0)).toBe(6);
  wb.setInput(id, 3, 1, '=SUM(B1:B3)*2');
  expect(wb.getValue(id, 3, 1)).toBe(12);
});
