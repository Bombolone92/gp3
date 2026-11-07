import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Running totals name a distinct range per row (=SUM($A$1:A1), =SUM($A$1:A2), ...). Each read was
// kept for other formulas naming the same range, so 20,000 of them held 200 million cells and
// exporting the sheet ran out of memory.
it('bounds the cells the range cache holds when every formula names a different range', { timeout: 60000 }, () => {
  const rows = 2500;
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, rows + 1, 3);
  const entries = [];
  for (let r = 0; r < rows; r++) {
    entries.push({ r, c: 0, cell: { v: r + 1, f: null } });
    entries.push({ r, c: 1, cell: { v: null, f: `A${r + 1}*2+SUM($A$1:A${r + 1})` } });
  }
  wb.setCells(id, entries, 'fill');
  for (let r = 0; r < rows; r++) expect(wb.getValue(id, r, 1)).toBe((r + 1) * 2 + ((r + 1) * (r + 2)) / 2);
  let held = 0;
  for (const values of wb._rangeCache.values()) held += values.length;
  expect(held).toBeLessThanOrEqual(250_000); // about 40 MB of single-cell rows
  expect(held).toBeGreaterThan(0); // the most recent reads are still shared
  // An edit is still seen by every dependent.
  wb.setInput(id, 0, 0, '1001');
  expect(wb.getValue(id, 9, 1)).toBe(20 + 55 + 1000);
  expect(wb.getValue(id, rows - 1, 1)).toBe(rows * 2 + (rows * (rows + 1)) / 2 + 1000);
}); // ~3.6 s of work on a quiet machine; vitest's 5 s default fails under load
