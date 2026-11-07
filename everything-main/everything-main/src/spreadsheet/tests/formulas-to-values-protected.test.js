import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('reports nothing replaced when a protected range refuses converting formulas to values', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 6; r++) wb.setInput(id, r, 4, `=${r}+1`);
  wb.protectRange(id, { r1: 2, c1: 0, r2: 3, c2: 4 }, 'locked');
  wb.clearHistory();
  const before = wb.toJSON();
  const notices = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') notices.push(e.detail); });
  expect(wb.formulasToValues(id, { r1: 0, c1: 4, r2: 5, c2: 4 })).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(notices).toHaveLength(1);
  // The unprotected part still converts, and is counted.
  expect(wb.formulasToValues(id, { r1: 0, c1: 4, r2: 1, c2: 4 })).toBe(2);
  expect(wb.getCell(id, 0, 4)).toMatchObject({ v: 1, f: null });
  expect(wb.getCell(id, 1, 4)).toMatchObject({ v: 2, f: null });
});

it('counts only the formulas it replaced on a protected sheet too', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=1+1');
  wb.setSheetProtected(id, true);
  expect(wb.formulasToValues(id, { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(0);
  expect(wb.getCell(id, 0, 0).f).toBe('1+1');
});
