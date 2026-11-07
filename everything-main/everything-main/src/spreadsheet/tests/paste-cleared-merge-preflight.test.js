import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
it.each([false, true])('preflights cells exposed by removing a destination merge (transpose=%s)', transpose => {
  const wb = new Workbook(), id = wb.activeSheetId, merge = { r1: 4, r2: 5, c1: 3, c2: 3 };
  wb.mergeCells(id, merge); wb.protectRange(id, { r1: 5, r2: 5, c1: 3, c2: 3 }, 'Keep covered cell');
  const before = wb.toJSON();
  const cells = transpose ? [[{ v: 'One' }, { v: 'Two' }]] : [[{ v: 'One' }], [{ v: 'Two' }]];
  expect(wb.pasteCells(id, cells, 4, 3, null, null, { transpose, checkOnly: true, clearMerges: [merge] })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
});
