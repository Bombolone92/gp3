import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function numbered() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 10; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 1, String((r + 1) * 10)); }
  return { wb, id };
}

describe('moving lines through a range that only partly covers them', () => {
  it.each([
    ['SUM(A1:A3)', 1, 1, 10, 'SUM(A1:A2)', 4], // row 2 leaves the range for the end
    ['SUM(A2:A3)', 1, 1, 10, 'SUM(A2:A2)', 3],
    ['SUM(A1:A3)', 1, 1, 4, 'SUM(A1:A2)', 4], // and for a spot below the range
    ['SUM(A5:A7)', 8, 1, 6, 'SUM(A5:A8)', 5 + 6 + 9 + 7], // row 9 lands inside the range
    ['SUM(A4:A6)', 8, 1, 5, 'SUM(A4:A7)', 4 + 5 + 6 + 9],
    ['SUM(A1:A10)', 1, 1, 10, 'SUM(A1:A10)', 55], // a range holding the whole block keeps it
    ['SUM(A5:A7)', 1, 1, 10, 'SUM(A4:A6)', 18], // ranges beside the block shift with it
    ['SUM(A8:A10)', 1, 1, 5, 'SUM(A8:A10)', 27],
  ])('%s after moving row %i (+%i) before row %i reads %s = %i', (formula, from, count, to, text, value) => {
    const { wb, id } = numbered();
    wb.setInput(id, 29, 3, `=${formula}`);
    expect(wb.moveRows(id, from, count, to)).not.toBeNull();
    expect(wb.getCell(id, 29, 3).f).toBe(text);
    expect(wb.getValue(id, 29, 3)).toBe(value);
  });

  it('applies the same rule to columns and to a moved block of several lines', () => {
    const { wb, id } = numbered();
    wb.setInput(id, 20, 0, '=SUM(A1:B1)');
    wb.moveCols(id, 1, 1, 5);
    expect(wb.getCell(id, 20, 0).f).toBe('SUM(A1:A1)');
    expect(wb.getValue(id, 20, 0)).toBe(1);
    const two = numbered();
    two.wb.setInput(two.id, 29, 3, '=SUM(A1:A4)');
    two.wb.moveRows(two.id, 2, 2, 10); // rows 3 and 4 go to the end
    expect(two.wb.getCell(two.id, 29, 3).f).toBe('SUM(A1:A2)');
    expect(two.wb.getValue(two.id, 29, 3)).toBe(3);
    two.wb.undo();
    expect(two.wb.getCell(two.id, 29, 3).f).toBe('SUM(A1:A4)');
    expect(two.wb.getValue(two.id, 29, 3)).toBe(10);
  });
});
