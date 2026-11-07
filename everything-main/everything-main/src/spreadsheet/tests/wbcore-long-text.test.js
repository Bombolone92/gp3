import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';

// A cell can hold no more text than a file stores, so the rest was silently lost on save.
it('keeps only as much typed text as a file can hold, and says so', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const events = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'truncated') events.push(e.detail); });
  wb.setInput(id, 0, 0, 'x'.repeat(MAX_TEXT + 5000));
  expect(wb.getCell(id, 0, 0).v.length).toBe(MAX_TEXT);
  expect(events).toEqual([{ type: 'truncated', sheetId: id, r: 0, c: 0, max: MAX_TEXT }]);
  wb.setInput(id, 1, 0, 'y'.repeat(MAX_TEXT + 1), { literal: true });
  expect(wb.getCell(id, 1, 0).v.length).toBe(MAX_TEXT);
  expect(events).toHaveLength(2);
  // Text that fits is untouched and announces nothing.
  wb.setInput(id, 2, 0, 'z'.repeat(MAX_TEXT));
  expect(wb.getCell(id, 2, 0).v.length).toBe(MAX_TEXT);
  expect(events).toHaveLength(2);
});
