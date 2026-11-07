import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('distinguishes empty text from an empty cell in scalar and array tests', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=""');
  wb.setInput(id, 1, 0, '=IF(TRUE,"","text")');
  wb.setInput(id, 2, 0, ' ');
  wb.setInput(id, 0, 2, '=ISBLANK("")');
  expect(wb.getValue(id, 0, 2)).toBe(false);
  wb.setInput(id, 0, 2, '=ISBLANK(A1:A4)');
  expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 2))).toEqual([false, false, false, true]);
  wb.setInput(id, 0, 0, '');
  expect(wb.getValue(id, 0, 2)).toBe(true);
  wb.undo();
  expect(wb.getValue(id, 0, 2)).toBe(false);
});

it('does not highlight formulas returning empty text as empty cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  wb.setInput(id, 0, 0, '=""');
  wb.setInput(id, 1, 0, 'Text');
  wb.addRule(id, { range, type: 'formula', value: '=ISBLANK(A1)', style: { bg: '#eee' } });
  expect(wb.conditionalStyle(id, 0, 0, wb.getValue(id, 0, 0))).toBeNull();
  expect(wb.conditionalStyle(id, 1, 0, wb.getValue(id, 1, 0))).toBeNull();
  expect(wb.conditionalStyle(id, 2, 0, wb.getValue(id, 2, 0))).toEqual({ bg: '#eee' });
});
