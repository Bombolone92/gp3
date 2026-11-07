import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// The filter menu's value list skipped rows the user had hidden by hand while _applyFilter went on judging
// them, so a row could be filtered out by a value that was never on offer to untick: tick everything the
// list showed, press Apply, and Show rows could no longer bring the row back. The list now covers the same
// rows the filter judges.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['H', 'K'], ['a', 'p'], ['b', 'q'], ['c', 'p']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  wb.setFilterRange(id, parseRange('A1:B4'));
  return { wb, id };
}

const list = (wb, id, col) => wb.filterValues(id, col).map(({ value }) => value);

describe('the filter menu lists the values of rows hidden by hand', () => {
  it('offers a hidden row\'s value, so ticking the whole list leaves that row alone', () => {
    const { wb, id } = book();
    wb.setHidden(id, 'row', [2], true);
    expect(list(wb, id, 0)).toEqual(['a', 'b', 'c']);
    wb.setFilterCriteria(id, 0, { values: list(wb, id, 0) });
    expect([...wb.sheet(id).filterHidden]).toEqual([]);
    wb.setHidden(id, 'row', [2], false);
    expect(wb.isRowHidden(id, 2)).toBe(false);
  });

  it('counts a hidden row\'s fill in the colour list too', () => {
    const { wb, id } = book();
    wb.applyStyle(id, parseRange('A3:A3'), { bg: '#ffff00' });
    wb.setHidden(id, 'row', [2], true);
    expect(wb.filterColors(id, 0)).toEqual([{ color: '#ffff00', count: 1 }, { color: '', count: 2 }]);
  });

  it('still filters a hidden row out when its value is unticked, and shows it again when it is ticked back', () => {
    const { wb, id } = book();
    wb.setHidden(id, 'row', [2], true);
    wb.setFilterCriteria(id, 0, { values: ['a', 'c'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([2]);
    wb.setHidden(id, 'row', [2], false);
    expect(wb.isRowHidden(id, 2)).toBe(true); // the filter excludes it, and says so in its own list
    expect(list(wb, id, 0)).toEqual(['a', 'b', 'c']);
    wb.setFilterCriteria(id, 0, { values: ['a', 'b', 'c'] });
    expect(wb.isRowHidden(id, 2)).toBe(false);
  });

  it('hides a row by hand after a filter is on, and shows it again untouched by the filter', () => {
    const { wb, id } = book();
    wb.setFilterCriteria(id, 1, { values: ['p'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([2]);
    wb.setHidden(id, 'row', [1], true);
    // The other column's list still names every row the filter weighs, hidden by hand or by a criterion.
    expect(list(wb, id, 0)).toEqual(['a', 'b', 'c']);
    wb.setHidden(id, 'row', [1], false);
    expect(wb.isRowHidden(id, 1)).toBe(false);
    expect(wb.isRowHidden(id, 2)).toBe(true);
  });
});
