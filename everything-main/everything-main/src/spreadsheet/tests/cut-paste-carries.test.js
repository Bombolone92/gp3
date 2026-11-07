import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A drag-move carried notes, merges, validation rules and conditional formats
// along with the cells; a cut followed by a paste left them all at the source.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'title');
  wb.setInput(id, 1, 0, '5');
  wb.setInput(id, 1, 1, '=A2*2');
  wb.setNote(id, 0, 0, 'a note');
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
  wb.addValidation(id, { type: 'number', range: { r1: 1, c1: 0, r2: 1, c2: 0 } });
  wb.addRule(id, { type: 'gt', value: 3, range: { r1: 1, c1: 0, r2: 1, c2: 1 }, style: { bg: '#ffff00' } });
  return { wb, id };
}
const cutBlock = (wb, id, range) => {
  const cells = wb.copyCells(id, [range.r1, range.r2], [range.c1, range.c2]);
  wb.clearRange(id, range, { contents: true, styles: true });
  return cells;
};

describe('cut and paste', () => {
  it('moves notes, merges, validation and conditional formats with the cells on the same sheet', () => {
    const { wb, id } = book();
    const src = { r1: 0, c1: 0, r2: 1, c2: 1 };
    const cells = cutBlock(wb, id, src);
    expect(wb.placeMoved(id, 5, 5, cells, { sheetId: id, range: src })).toEqual({ r1: 5, c1: 5, r2: 6, c2: 6 });
    expect(wb.getNote(id, 5, 5)).toBe('a note');
    expect(wb.getNote(id, 0, 0)).toBeNull();
    expect(wb.sheets[0].merges).toEqual([{ r1: 5, c1: 5, r2: 5, c2: 6 }]);
    expect(wb.sheets[0].validations.map((v) => v.range)).toEqual([{ r1: 6, c1: 5, r2: 6, c2: 5 }]);
    expect(wb.sheets[0].rules.map((v) => v.range)).toEqual([{ r1: 6, c1: 5, r2: 6, c2: 6 }]);
    expect(wb.getCell(id, 6, 6).f).toBe('F7*2');
    expect(wb.getValue(id, 6, 6)).toBe(10);
    wb.undo();
    expect(wb.getNote(id, 0, 0)).toBe('a note');
    expect(wb.sheets[0].merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }]);
  });

  it('moves them across sheets too, and clears what they land on', () => {
    const { wb, id } = book();
    const other = wb.addSheet('Two').id;
    wb.setNote(other, 5, 5, 'old note here');
    wb.mergeCells(other, { r1: 6, c1: 5, r2: 6, c2: 6 }); // wholly under the landing block: it gives way (one it would only partly cover refuses the move)
    const src = { r1: 0, c1: 0, r2: 1, c2: 1 };
    const cells = cutBlock(wb, id, src);
    expect(wb.placeMoved(other, 5, 5, cells, { sheetId: id, range: src })).toBeTruthy();
    expect(wb.getNote(other, 5, 5)).toBe('a note');
    expect(wb.getNote(id, 0, 0)).toBeNull();
    expect(wb.sheets[0].merges).toEqual([]);
    expect(wb.sheet(other).merges).toEqual([{ r1: 5, c1: 5, r2: 5, c2: 6 }]);
    expect(wb.sheets[0].validations).toEqual([]);
    expect(wb.sheet(other).validations.map((v) => v.range)).toEqual([{ r1: 6, c1: 5, r2: 6, c2: 5 }]);
    expect(wb.sheet(other).rules.map((v) => v.range)).toEqual([{ r1: 6, c1: 5, r2: 6, c2: 6 }]);
  });
});
