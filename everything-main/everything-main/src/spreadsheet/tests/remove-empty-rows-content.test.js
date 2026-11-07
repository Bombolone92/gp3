import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// "Remove empty rows" judged a row by its stored cells only. Rows showing a
// spilled array's results, or carrying a note, have nothing stored and were
// deleted with their content.
describe('removing empty rows', () => {
  it('keeps the rows a spilled array fills', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(3)');
    wb.setInput(id, 4, 0, 'x');
    expect(wb.getValue(id, 2, 0)).toBe(3);
    expect(wb.removeEmptyRows(id, { r1: 0, c1: 0, r2: 5, c2: 0 })).toBe(2); // rows 4 and 6 in A1 terms
    expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 0))).toEqual([1, 2, 3, 'x']);
  });

  it('keeps a row that only carries a note', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a');
    wb.setNote(id, 1, 0, 'remember this');
    wb.setInput(id, 3, 0, 'b');
    expect(wb.removeEmptyRows(id, { r1: 0, c1: 0, r2: 3, c2: 0 })).toBe(1);
    expect(wb.getNote(id, 1, 0)).toBe('remember this');
    expect(wb.getValue(id, 2, 0)).toBe('b');
  });
});
