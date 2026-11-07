import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } })));

it('refuses filter changes on a protected sheet and says so, like every other edit', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Name', 'Amt'], ['x', 5], ['y', 7]]));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
  wb.setFilterCriteria(id, 1, { values: ['5'] });
  wb.setSheetProtected(id, true);
  wb.clearHistory();
  const before = wb.toJSON();
  const refused = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') refused.push(e.detail.sheetId); });
  wb.setFilterCriteria(id, 1, { values: ['7'] });
  wb.clearFilter(id);
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  expect(wb.toJSON()).toEqual(before);
  expect([...wb.sheet(id).filterHidden]).toEqual([2]);
  expect(refused).toEqual([id, id, id]);
  expect(wb.canUndo()).toBe(false);
  wb.setSheetProtected(id, false);
  wb.setFilterCriteria(id, 1, { values: ['7'] });
  expect([...wb.sheet(id).filterHidden]).toEqual([1]);
});
