import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

describe('goal seek and the cell it changes', () => {
  it('refuses a cell that shows part of a spilled result', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 9, '=SEQUENCE(3)'); // J1:J3
    wb.setInput(id, 0, 7, '=J2*2'); // H1
    expect(wb.getValue(id, 0, 7)).toBe(4);
    const result = wb.goalSeek(id, { r: 0, c: 7 }, 13, { r: 1, c: 9 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('The cell to change shows part of an array formula\'s result');
    expect(wb.getCell(id, 1, 9)).toBeUndefined();
    expect(wb.getValue(id, 1, 9)).toBe(2);
    expect(wb.getValue(id, 0, 9)).toBe(1);
  });

  it('writes nothing when the goal is already met', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    wb.setInput(id, 0, 1, '=A1*2');
    wb.setInput(id, 0, 2, '=IF(D1=0, 7, 1)');
    const steps = wb._history.length;
    expect(wb.goalSeek(id, { r: 0, c: 1 }, 10, { r: 0, c: 0 })).toMatchObject({ ok: true, value: 5, result: 10 });
    expect(wb.getCell(id, 0, 0).v).toBe(5);
    // A blank cell the formula already reads as zero stays blank rather than becoming 0.
    expect(wb.goalSeek(id, { r: 0, c: 2 }, 7, { r: 0, c: 3 })).toMatchObject({ ok: true, value: 0, result: 7 });
    expect(wb.getCell(id, 0, 3)).toBeUndefined();
    expect(wb._history.length).toBe(steps);
    // A goal not yet met is still sought.
    expect(wb.goalSeek(id, { r: 0, c: 1 }, 20, { r: 0, c: 0 })).toMatchObject({ ok: true, value: 10, result: 20 });
    expect(wb.getCell(id, 0, 0).v).toBe(10);
  });
});
