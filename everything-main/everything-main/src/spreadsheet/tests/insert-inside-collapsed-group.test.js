import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Lines inserted inside a collapsed outline group grew the group but stayed
// visible, showing through a group whose button said it was closed. They now
// join the group hidden, like the rest of it, until the group is expanded.
function book(axis) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let i = 0; i < 6; i++) wb.setInput(id, axis === 'row' ? i : 0, axis === 'row' ? 0 : i, String(i + 1));
  wb.groupLines(id, axis, 1, 3);
  wb.toggleGroup(id, axis, 1, 3);
  return { wb, id };
}
const hidden = (wb, id, axis) => [...(axis === 'row' ? wb.sheet(id).hiddenRows : wb.sheet(id).hiddenCols)].sort((a, b) => a - b);
const groups = (wb, id, axis) => wb.sheet(id).groups[axis === 'row' ? 'rows' : 'cols'];

describe.each(['row', 'col'])('%ss inserted inside a collapsed group', (axis) => {
  it('are hidden with the group until it is expanded', () => {
    const { wb, id } = book(axis);
    expect(hidden(wb, id, axis)).toEqual([1, 2, 3]);
    expect(axis === 'row' ? wb.insertRows(id, 2, 2) : wb.insertCols(id, 2, 2)).toBe(true);
    expect(groups(wb, id, axis)).toEqual([{ from: 1, to: 5, collapsed: true }]);
    expect(hidden(wb, id, axis)).toEqual([1, 2, 3, 4, 5]);
    wb.toggleGroup(id, axis, 1, 5);
    expect(hidden(wb, id, axis)).toEqual([]);
    wb.undo();
    wb.undo();
    expect(groups(wb, id, axis)).toEqual([{ from: 1, to: 3, collapsed: true }]);
    expect(hidden(wb, id, axis)).toEqual([1, 2, 3]);
  });

  it('stay visible when inserted at the group\'s first line, which moves the group down, or after its last', () => {
    const { wb, id } = book(axis);
    expect(axis === 'row' ? wb.insertRows(id, 1, 1) : wb.insertCols(id, 1, 1)).toBe(true);
    expect(groups(wb, id, axis)).toEqual([{ from: 2, to: 4, collapsed: true }]);
    expect(hidden(wb, id, axis)).toEqual([2, 3, 4]);
    expect(axis === 'row' ? wb.insertRows(id, 5, 1) : wb.insertCols(id, 5, 1)).toBe(true);
    expect(groups(wb, id, axis)).toEqual([{ from: 2, to: 4, collapsed: true }]);
    expect(hidden(wb, id, axis)).toEqual([2, 3, 4]);
  });
});
