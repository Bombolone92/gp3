import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('refuses to add, change, or delete a note in a protected range, and says so', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setNote(id, 1, 0, 'kept');
  wb.protectRange(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, 'locked');
  wb.clearHistory();
  const before = wb.toJSON();
  const notices = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') notices.push(e.detail); });
  wb.setNote(id, 0, 0, 'hello');
  wb.setNote(id, 1, 0, 'changed');
  wb.setNote(id, 1, 0, null);
  expect(wb.getNote(id, 0, 0)).toBeNull();
  expect(wb.getNote(id, 1, 0)).toBe('kept');
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(notices).toHaveLength(3);
  expect(notices[0]).toMatchObject({ description: 'locked', range: { r1: 0, c1: 0, r2: 1, c2: 0 } });
  // Cells outside the range take notes as before.
  wb.setNote(id, 2, 0, 'free');
  expect(wb.getNote(id, 2, 0)).toBe('free');
});
