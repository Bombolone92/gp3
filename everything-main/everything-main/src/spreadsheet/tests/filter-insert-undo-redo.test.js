import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A row inserted inside a filtered list stays in view until the filter runs again. Undo and redo of the
// insertion reload a snapshot, and the reloaded sheet ran its filter afresh, which hid the blank row the
// insertion had shown: redo showed fewer rows than the step it repeated.
describe('undo and redo of a row insertion inside a filtered list', () => {
  const filtered = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, String(r));
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
    wb.setFilterCriteria(id, 0, { values: ['1', '2'] });
    return { wb, id, hidden: () => [...wb.sheet(id).filterHidden].sort((a, b) => a - b) };
  };

  it('shows the inserted row after a redo as it did after the insertion', () => {
    const { wb, id, hidden } = filtered();
    expect(hidden()).toEqual([3, 4]);
    wb.insertRows(id, 1, 1);
    expect(hidden()).toEqual([4, 5]);
    wb.undo();
    expect(hidden()).toEqual([3, 4]);
    wb.redo();
    expect(hidden()).toEqual([4, 5]);
    wb.undo();
    expect(hidden()).toEqual([3, 4]);
    // The saved view remains separate from predicates, so drafts and files
    // can retain rows that have not been refiltered since their last edit.
    expect(wb.toJSON().sheets[0].filterHidden).toEqual([3, 4]);
  });

  it('brings back what the user saw before a later structural edit, shown rows included', () => {
    const { wb, id, hidden } = filtered();
    wb.insertRows(id, 1, 1);
    wb.setInput(id, 1, 0, '9'); // a value the filter would hide, in a row it shows until it runs again
    expect(hidden()).toEqual([4, 5]);
    wb.insertCols(id, 3, 1); // runs the filter again: the row goes
    expect(hidden()).toEqual([1, 4, 5]);
    wb.undo();
    expect(hidden()).toEqual([4, 5]);
    wb.redo();
    expect(hidden()).toEqual([1, 4, 5]);
  });

  it('keeps a deletion in a filtered list symmetric, and the filter of a second sheet its own', () => {
    const { wb, id, hidden } = filtered();
    const two = wb.addSheet('Two').id;
    for (let r = 0; r < 4; r++) wb.setInput(two, r, 0, r % 2 ? 'a' : 'b');
    wb.setFilterRange(two, { r1: 0, c1: 0, r2: 3, c2: 0 });
    wb.setFilterCriteria(two, 0, { values: ['a'] });
    const hiddenTwo = () => [...wb.sheet(two).filterHidden].sort((a, b) => a - b);
    expect(hiddenTwo()).toEqual([2]);
    wb.deleteRows(id, 2, 1);
    expect(hidden()).toEqual([2, 3]);
    wb.undo();
    expect([hidden(), hiddenTwo()]).toEqual([[3, 4], [2]]);
    wb.redo();
    expect([hidden(), hiddenTwo()]).toEqual([[2, 3], [2]]);
  });
});
