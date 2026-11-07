import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Building a string longer than the engine allows throws a RangeError, which was taken for a stack
// overflow: the formula was evaluated once more from the bottom up and then shown as #ERROR!.
it('shows #VALUE! for a text result too long to build', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SUBSTITUTE(REPT("a",32767),"a",REPT("b",32767))');
  wb.setInput(id, 1, 0, '=REGEXREPLACE(REPT("a",32767),"a",REPT("b",32767))');
  wb.setInput(id, 2, 0, '=IFERROR(A1, "too long")');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#VALUE!' });
  expect(wb.getValue(id, 1, 0)).toEqual({ error: '#VALUE!' });
  expect(wb.getValue(id, 2, 0)).toBe('too long');
});
