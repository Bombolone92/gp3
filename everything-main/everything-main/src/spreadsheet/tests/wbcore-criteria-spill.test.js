import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function sheet() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['x', 'y', 'x'].forEach((v, r) => wb.setInput(id, r, 0, v));
  [1, 2, 3].forEach((v, r) => wb.setInput(id, r, 1, String(v)));
  return { wb, id };
}

// COUNTIF(A1:A3,A1:A3) answers in the criterion's shape and spilled when its anchor was read, but the
// sheet did not know it for an array formula, so a dependent or a covered cell read first stayed blank.
describe('the *IF family with an array criterion', () => {
  it('is an array candidate when the criterion may be a range, not when it is one value or consumed', () => {
    const { wb } = sheet();
    const candidate = (f) => wb._isArrayCandidate(wb._ast(f));
    expect(candidate('COUNTIF(A1:A3,A1:A3)')).toBe(true);
    expect(candidate('SUMIF(A1:A3,A1:A3,B1:B3)')).toBe(true);
    expect(candidate('SUMIFS(B1:B3,A1:A3,A1:A3)')).toBe(true);
    expect(candidate('COUNTIFS(A1:A3,"x",B1:B3,B1:B3)')).toBe(true);
    expect(candidate('MAXIFS(B1:B3,A1:A3,{"x","y"})')).toBe(true);
    expect(candidate('COUNTIF(A1:A3,"x")')).toBe(false);
    expect(candidate('COUNTIF(A1:A3,C1)')).toBe(false);
    expect(candidate('SUMIFS(B1:B3,A1:A3,"x",B1:B3,">1")')).toBe(false);
    expect(candidate('SUM(COUNTIF(A1:A3,A1:A3))')).toBe(false);
  });

  it('spills before a dependent of a covered cell is read', () => {
    const { wb, id } = sheet();
    wb.setInput(id, 0, 3, '=COUNTIF(A1:A3,A1:A3)');
    wb.setInput(id, 0, 2, '=D2*10');
    expect(wb.getValue(id, 0, 2)).toBe(10);
    expect(wb.getValue(id, 0, 3)).toBe(2);
    expect(wb.getValue(id, 2, 3)).toBe(2);
    expect(wb.getValue(id, 0, 2)).toBe(10);
    expect(wb.spillRangeAt(id, 0, 3)).toMatchObject({ r1: 0, c1: 3, r2: 2, c2: 3 });
  });

  it('shows a covered cell read before its anchor', () => {
    const { wb, id } = sheet();
    wb.setInput(id, 0, 3, '=SUMIFS(B1:B3,A1:A3,A1:A3)');
    expect(wb.getValue(id, 1, 3)).toBe(2);
    expect(wb.getValue(id, 0, 3)).toBe(4);
    expect(wb.getValue(id, 2, 3)).toBe(4);
  });

  it('keeps a summed criterion count in one cell', () => {
    const { wb, id } = sheet();
    wb.setInput(id, 0, 3, '=SUM(COUNTIF(A1:A3,{"x","y"}))');
    expect(wb.getValue(id, 0, 3)).toBe(3);
    expect(wb.spillRangeAt(id, 0, 3)).toBeNull();
  });
});
