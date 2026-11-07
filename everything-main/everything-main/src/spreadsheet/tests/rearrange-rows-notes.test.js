import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Sorting already carries notes with their rows; removing duplicates and
// randomizing a range left them where they were, attached to other data.
describe('notes when rows are rearranged', () => {
  it('move up with their row when duplicates are removed, and go with a removed duplicate', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    ['a', 'a', 'b'].forEach((v, r) => wb.setInput(id, r, 0, v));
    wb.setNote(id, 1, 0, 'on the duplicate');
    wb.setNote(id, 2, 0, 'on b');
    expect(wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 2, c2: 0 })).toBe(1);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['a', 'b', null]);
    expect(wb.getNote(id, 1, 0)).toBe('on b');
    expect(wb.getNote(id, 2, 0)).toBeNull();
    wb.undo();
    expect(wb.getNote(id, 1, 0)).toBe('on the duplicate');
    expect(wb.getNote(id, 2, 0)).toBe('on b');
  });

  it('follow their row when a range is randomized', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    ['r1', 'r2', 'r3'].forEach((v, r) => wb.setInput(id, r, 0, v));
    wb.setNote(id, 0, 0, 'first');
    expect(wb.shuffleRows(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { random: () => 0 })).toBeGreaterThan(0);
    const values = [0, 1, 2].map((r) => wb.getValue(id, r, 0));
    expect(wb.getNote(id, values.indexOf('r1'), 0)).toBe('first');
    expect([0, 1, 2].filter((r) => wb.getNote(id, r, 0))).toHaveLength(1);
  });
});
