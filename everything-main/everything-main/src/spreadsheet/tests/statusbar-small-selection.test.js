import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { summarize } from '../src/ui/statusbar.js';

it('summarizes a small selection without walking every cell of a large sheet', () => {
  const rows = 40000;
  const wb = new Workbook({ sheets: [{ name: 'S', rows: rows + 1, cols: 3, cells: Object.fromEntries(
    Array.from({ length: rows }, (_, r) => [[`${r},0`, { v: r }], [`${r},1`, { v: 'x' }]]).flat(),
  ) }] });
  const id = wb.activeSheetId;
  const sheet = wb.sheet(id);
  wb.usedRange(id); // the one-time bounds and spill scans for this version happen here, not in the summary
  let iterated = 0;
  const original = sheet.cells[Symbol.iterator].bind(sheet.cells);
  sheet.cells[Symbol.iterator] = function* () { iterated++; yield* original(); };
  expect(summarize(wb, id, { r1: 10, c1: 0, r2: 13, c2: 1 })).toMatchObject({ sum: 46, count: 8, nums: 4, min: 10, max: 13, avg: 11.5 });
  expect(iterated).toBe(0);
  // A whole-sheet selection still uses the single pass over the map.
  expect(summarize(wb, id, { r1: 0, c1: 0, r2: 19999, c2: 0 })).toMatchObject({ count: 20000, nums: 20000 });
});
