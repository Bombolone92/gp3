import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Names were looked up on the active sheet, so a sheet-scoped name used on another sheet
// traced no dependents or precedents unless that sheet happened to be the active one.
it('traces a sheet-scoped name through the formula\'s own sheet, whichever sheet is active', () => {
  const wb = new Workbook();
  const first = wb.activeSheetId;
  const second = wb.addSheet('Two').id;
  wb.setInput(second, 0, 0, '7');
  expect(wb.defineName('Rate', 'Two!$A$1', 'Two')).toBeNull();
  wb.setInput(second, 1, 0, '=Rate*2');
  wb.setActiveSheet(first);
  expect(wb.getValue(second, 1, 0)).toBe(14);
  expect(wb.dependents(second, 0, 0)).toEqual([{ sheetId: second, r: 1, c: 0 }]);
  expect(wb.precedents(second, 1, 0)).toEqual([{ sheetId: second, r: 0, c: 0 }]);
  wb.setActiveSheet(second);
  expect(wb.dependents(second, 0, 0)).toEqual([{ sheetId: second, r: 1, c: 0 }]);
});
