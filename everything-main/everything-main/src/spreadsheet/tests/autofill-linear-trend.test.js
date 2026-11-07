import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// AutoFill continues numbers without a constant step along their best-fit line.
it('continues uneven numbers along their least-squares line, down and up', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [1, 2, 4].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.fill(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { r1: 0, c1: 0, r2: 5, c2: 0 });
  expect([3, 4, 5].map(r => wb.getValue(id, r, 0))).toEqual([5.33333333333333, 6.83333333333333, 8.33333333333333]);
  [1, 2, 4].forEach((v, r) => wb.setInput(id, r + 3, 1, String(v)));
  wb.fill(id, { r1: 3, c1: 1, r2: 5, c2: 1 }, { r1: 0, c1: 1, r2: 5, c2: 1 });
  expect([0, 1, 2].map(r => wb.getValue(id, r, 1))).toEqual([-3.66666666666667, -2.16666666666667, -0.666666666666667]);
  // An even step still counts on exactly.
  [2, 4, 6].forEach((v, r) => wb.setInput(id, r, 2, String(v)));
  wb.fill(id, { r1: 0, c1: 2, r2: 2, c2: 2 }, { r1: 0, c1: 2, r2: 4, c2: 2 });
  expect([3, 4].map(r => wb.getValue(id, r, 2))).toEqual([8, 10]);
});
