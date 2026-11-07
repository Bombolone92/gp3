import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { addSubtotals, removeSubtotals } from '../src/core/subtotal.js';

// Subtotal inserts its group totals inside the list and its grand total under it. The rows inside grew the
// filter's range with them while the ones at the foot landed outside it, so the first group's total sat
// under the filter and the rest did not: changing the filter afterwards made one total row disappear and
// left the others. The filter now covers every row the tool wrote, and they stay in view until it is
// applied again, as rows added to a filtered table do.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Reg', 'Amt'], ['W', 1], ['E', 2], ['W', 3], ['E', 4]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.setFilterRange(id, parseRange('A1:B5'));
  return { wb, id, labels: () => Array.from({ length: 8 }, (_, r) => wb.getDisplay(id, r, 0)) };
}

describe('Subtotal over a filtered list', () => {
  it('covers every total row with the filter and leaves them all in view', () => {
    const { wb, id, labels } = book();
    wb.setFilterCriteria(id, 0, { values: ['W'] });
    expect(addSubtotals(wb, id, parseRange('A1:B5'), { groupCol: 0, code: 9, totalCols: [1] })).toEqual(parseRange('A1:B8'));
    expect(labels()).toEqual(['Reg', 'E', 'E', 'E Total', 'W', 'W', 'W Total', 'Grand Total']);
    expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:B8'));
    expect([...wb.sheet(id).filterHidden]).toEqual([1, 2]); // the filtered-out data rows only
    expect(wb.getValue(id, 7, 1)).toBe(4); // the grand total over the rows in view
  });

  it('hides the three total rows together when the filter is changed afterwards', () => {
    const { wb, id } = book();
    wb.setFilterCriteria(id, 0, { values: ['W'] });
    addSubtotals(wb, id, parseRange('A1:B5'), { groupCol: 0, code: 9, totalCols: [1] });
    wb.setFilterCriteria(id, 0, { values: ['E'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([3, 4, 5, 6, 7]);
    wb.setFilterCriteria(id, 0, null);
    expect([...wb.sheet(id).filterHidden]).toEqual([]);
  });

  it('leaves an unfiltered list and a filter elsewhere on the sheet alone', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Reg', 'Amt'], ['W', 1], ['E', 2]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
    [['Other'], ['x'], ['y']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r + 10, c + 4, v)));
    wb.setFilterRange(id, parseRange('E11:E13'));
    addSubtotals(wb, id, parseRange('A1:B3'), { groupCol: 0, code: 9, totalCols: [1] });
    // Pushed down three rows by the insertions, and no wider than it was.
    expect(wb.sheet(id).filter.range).toEqual(parseRange('E14:E16'));
  });

  it('shrinks the filter back with the total rows when they are removed and undone', () => {
    const { wb, id } = book();
    wb.setFilterCriteria(id, 0, { values: ['W'] });
    addSubtotals(wb, id, parseRange('A1:B5'), { groupCol: 0, code: 9, totalCols: [1] });
    expect(removeSubtotals(wb, id, parseRange('A1:B8'))).toBe(3);
    expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:B5'));
    wb.undo();
    expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:B8'));
  });
});

it('extends the subtotaled list’s filter even when another table is the current filter context', () => {
  const { wb, id } = book();
  ['Other', 'x', 'y'].forEach((v, i) => wb.setInput(id, 10 + i, 4, v));
  wb.addTable(id, parseRange('E11:E13'));
  wb.setFilterCriteria(id, 4, { values: ['x'] });
  addSubtotals(wb, id, parseRange('A1:B5'), { groupCol: 0, code: 9, totalCols: [1] });
  expect(wb.filterAt(id, 0, 0).range).toEqual(parseRange('A1:B8'));
  expect(wb.sheet(id).filter.range).toEqual(parseRange('E14:E16'));
  expect(wb.sheet(id).filter.criteria[4].values).toEqual(['x']);
});
