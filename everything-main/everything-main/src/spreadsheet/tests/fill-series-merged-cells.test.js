import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Fill series wrote a value into every cell of its range, the ones hidden under a merge included: the sheet
// showed 1, 2, 4, 5 while SUM saw a 3 nobody could see, and unmerging brought it to light.
it('writes nothing into cells hidden under a merge, as the fill handle does', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.mergeCells(id, { r1: 1, c1: 0, r2: 2, c2: 0 });
  wb.setInput(id, 6, 0, '=SUM(A1:A5)');
  expect(wb.fillSeries(id, { r1: 0, c1: 0, r2: 4, c2: 0 }, { type: 'linear', step: 1 })).toBe(3);
  expect([0, 1, 2, 3, 4].map((r) => wb.getValue(id, r, 0))).toEqual([1, 2, null, 4, 5]);
  expect(wb.getValue(id, 6, 0)).toBe(12);
  wb.unmergeCells(id, { r1: 1, c1: 0, r2: 2, c2: 0 });
  expect(wb.getValue(id, 2, 0)).toBeNull();
  expect(wb.getValue(id, 6, 0)).toBe(12);
});

it('passes over a merge across the row of a series filled to the right', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10');
  wb.mergeCells(id, { r1: 0, c1: 1, r2: 0, c2: 2 });
  expect(wb.fillSeries(id, { r1: 0, c1: 0, r2: 0, c2: 3 }, { type: 'growth', step: 2 })).toBe(2);
  expect([0, 1, 2, 3].map((c) => wb.getValue(id, 0, c))).toEqual([10, 20, null, 80]);
});
