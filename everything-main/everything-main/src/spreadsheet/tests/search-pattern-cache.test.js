import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { findAll } from '../src/core/search.js';

it('compiles a regular-expression search once rather than once per cell', () => {
  const wb = new Workbook({ sheets: [{ name: 'S', rows: 2000, cols: 2, cells: Object.fromEntries(
    Array.from({ length: 2000 }, (_, r) => [`${r},0`, { v: r % 7 ? `item ${r}` : `ITEM ${r}` }]),
  ) }] });
  const id = wb.activeSheetId;
  const Native = globalThis.RegExp;
  let compiles = 0;
  globalThis.RegExp = class extends Native { constructor(...args) { super(...args); compiles++; } };
  let hits;
  try { hits = findAll(wb, id, 'item \\d*5$', { regex: true }); } finally { globalThis.RegExp = Native; }
  expect(hits.length).toBeGreaterThan(100);
  // One compile for the pattern, not one per cell.
  expect(compiles).toBeLessThan(10);
  expect(findAll(wb, id, '(unclosed', { regex: true })).toEqual([]);
  expect(findAll(wb, id, '^ITEM', { regex: true, matchCase: true })).toHaveLength(Math.ceil(2000 / 7));
});
