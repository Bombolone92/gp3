import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Remove empty rows deleted each run of blank rows on its own, renumbering the
// whole sheet once per run: a 20,000-row sheet with every other row blank took
// over a minute. The rows now go in one pass.
it('removes thousands of scattered empty rows in one pass and one undo step', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const entries = [];
  for (let r = 0; r <= 4000; r += 2) for (let c = 0; c < 3; c++) entries.push({ r, c, cell: { v: r === 0 ? `H${c}` : r } });
  wb.setCells(id, entries);
  wb.setInput(id, 0, 5, '=SUM(B2:B4001)');
  wb.clearHistory();
  const before = wb.toJSON();
  const t0 = performance.now();
  expect(wb.removeEmptyRows(id, { r1: 0, c1: 0, r2: 4000, c2: 2 })).toBe(2000);
  const took = performance.now() - t0;
  expect(wb.sheet(id).rows).toBe(2001);
  expect([1, 2, 2000].map((r) => wb.getValue(id, r, 1))).toEqual([2, 4, 4000]);
  expect(wb.getCell(id, 0, 5).f).toBe('SUM(B2:B2001)');
  expect(wb.undoLabel()).toBe('Remove empty rows');
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  // Run by run this took seconds; a generous ceiling keeps a loaded machine from failing it.
  expect(took).toBeLessThan(2000);
});
