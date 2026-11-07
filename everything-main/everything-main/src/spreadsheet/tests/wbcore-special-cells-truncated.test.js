import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The list of cells of a kind stops at a limit; the editor can only say so when the list is marked.
it('marks a list of special cells cut short at the limit', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, 1300, 3);
  const entries = [];
  for (let r = 0; r < 1200; r += 2) entries.push({ r, c: 0, cell: { v: r, f: null } }); // 600 separate runs
  wb.setCells(id, entries, 'fill');
  const all = { r1: 0, c1: 0, r2: 1299, c2: 2 };
  const cut = wb.specialCells(id, all, 'numbers');
  expect(cut).toHaveLength(500);
  expect(cut.truncated).toBe(true);
  const whole = wb.specialCells(id, all, 'numbers', 600);
  expect(whole).toHaveLength(600);
  expect(whole.truncated).toBeUndefined();
  expect(wb.specialCells(id, all, 'text').truncated).toBeUndefined();
});
