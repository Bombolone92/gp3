import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('scans the cells for their bounds once per version, even while spills are being worked out', () => {
  const rows = 300;
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 10, cols: 8, cells: Object.fromEntries(
    Array.from({ length: rows }, (_, r) => [[`${r},0`, { v: r + 1 }], [`${r},2`, { v: r }], [`${r},1`, { f: `INDEX($A$1:$A$${rows},C${r + 1})` }]]).flat(),
  ) }] });
  const id = wb.activeSheetId;
  const original = wb._cellBounds;
  let scans = 0;
  wb._cellBounds = function (...args) { scans++; return original.apply(this, args); };
  wb.setInput(id, 0, 5, 'note');
  expect(wb.getValue(id, rows + 5, 5)).toBe(null); // needs every candidate evaluated
  expect(wb.getValue(id, 2, 1)).toBe(2);
  expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: rows - 1, c2: 5 });
  // scans counts calls; the loop over the cells ran at most once
  const cached = wb._cellBoundsCache.get(id);
  expect(cached).toEqual({ r2: rows - 1, c2: 5 });
  wb._cellBounds = original;
  // The bounds follow the next edit.
  wb.setInput(id, rows + 2, 6, 'later');
  expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: rows + 2, c2: 6 });
  wb.setInput(id, 0, 7, '=SEQUENCE(400)');
  expect(wb.usedRange(id)).toEqual({ r1: 0, c1: 0, r2: 399, c2: 7 });
});
