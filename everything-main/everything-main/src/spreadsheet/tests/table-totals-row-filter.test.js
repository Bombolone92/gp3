import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

/** Table over A1:D4 with a totals row under it (rows 0..4); its filter covers the header and data (rows 0..3). */
function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['A', 'B', 'C', 'D'], [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const table = wb.addTable(id, parseRange('A1:D4'), { totalsRow: true });
  expect(wb.tableById(id, table).range.r2).toBe(4);
  expect(wb.sheet(id).filter.range.r2).toBe(3);
  wb.clearHistory();
  return { wb, id, table };
}

describe('a table with a totals row', () => {
  it('grows its filter along with a row added at the bottom of its data', () => {
    const { wb, id, table } = setup();
    expect(wb.addTableRow(id, table)).toBe(4);
    expect(wb.tableById(id, table).range.r2).toBe(5);
    expect(wb.sheet(id).filter.range.r2).toBe(4);
    wb.setInput(id, 4, 0, '13');
    expect(wb.filterValues(id, 0).map((v) => v.value)).toEqual(['1', '5', '9', '13']);
    wb.setFilterCriteria(id, 0, { values: ['1', '5', '9'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([4]);
    wb.undo(); wb.undo(); wb.undo();
    expect(wb.tableById(id, table).range.r2).toBe(4);
    expect(wb.sheet(id).filter.range.r2).toBe(3);
    expect(wb.sheet(id).filterHidden.size).toBe(0);
    expect(wb.getCell(id, 4, 0).f).toMatch(/^SUBTOTAL/); // the totals row is back under the data
    expect(wb.getCell(id, 5, 0)).toBeUndefined();
    expect(wb.canUndo()).toBe(false);
  });

  it('grows its filter when rows are inserted right above the totals row, and not otherwise', () => {
    const { wb, id, table } = setup();
    expect(wb.insertRows(id, 4, 2)).toBe(true);
    expect(wb.tableById(id, table).range.r2).toBe(6);
    expect(wb.sheet(id).filter.range.r2).toBe(5);
    wb.undo();
    expect(wb.sheet(id).filter.range.r2).toBe(3);
    expect(wb.tableById(id, table).range.r2).toBe(4);
    expect(wb.canUndo()).toBe(false);
    wb.insertRows(id, 5, 1); // below the totals row: neither the table nor its filter grows
    expect(wb.tableById(id, table).range.r2).toBe(4);
    expect(wb.sheet(id).filter.range.r2).toBe(3);
    wb.insertRows(id, 2, 1); // inside the data: both grow already
    expect(wb.tableById(id, table).range.r2).toBe(5);
    expect(wb.sheet(id).filter.range.r2).toBe(4);
  });

  it('leaves a filter that is not the table\'s alone', () => {
    const { wb, id } = setup();
    wb.setCells(id, [['X'], [1], [2]].flatMap((row, r) => row.map((v, c) => ({ r, c: c + 6, cell: { v } }))));
    wb.setFilterRange(id, parseRange('G1:G3'));
    wb.insertRows(id, 4, 1);
    expect(wb.sheet(id).filter.range).toEqual(parseRange('G1:G3'));
  });
});
