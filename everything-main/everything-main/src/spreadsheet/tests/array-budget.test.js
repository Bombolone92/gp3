import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Each array generator capped its own output, but nested ones multiplied: one cell could
// build a hundred million elements and pin the processor for a quarter of a minute on open.
// Wall-clock caps are three times a quiet run so a shared machine does not fail them; a real regression is tenfold.
it('stops a formula whose nested arrays would build millions of cells, and lets ordinary ones through', { timeout: 60000 }, () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const t0 = performance.now();
  wb.setInput(id, 0, 0, '=SUM(MAKEARRAY(40,40,LAMBDA(r,c,SUM(SEQUENCE(1000,100)))))');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NUM!' });
  expect(performance.now() - t0).toBeLessThan(9000);
  wb.setInput(id, 1, 0, '=SUM(MAP(SEQUENCE(1000),LAMBDA(x,SUM(SEQUENCE(1000)))))');
  expect(wb.getValue(id, 1, 0)).toBe(500500000);
  wb.setInput(id, 2, 0, '=SUM(SEQUENCE(100000))');
  expect(wb.getValue(id, 2, 0)).toBe(5000050000);
  // The budget is per cell: a sheet of ordinary array formulas is not starved by its neighbours.
  for (let r = 3; r < 60; r++) wb.setInput(id, r, 0, '=SUM(SEQUENCE(50000))');
  expect(wb.getValue(id, 59, 0)).toBe(1250025000);
});
