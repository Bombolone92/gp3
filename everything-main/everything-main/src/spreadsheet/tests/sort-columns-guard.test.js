import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

function book(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, rows.flatMap((row, r) => row.map((v, c) => ({ r, c, cell: v == null ? null : { v } }))));
  return { wb, id };
}

const keys = [{ row: 0, ascending: true }];

describe('sorting columns left to right', () => {
  it('refuses a merge wider than one column and leaves everything in place', () => {
    const { wb, id } = book([[3, 1, 2], ['a', 'b', 'c']]);
    wb.mergeCells(id, parseRange('A2:B2'));
    const before = wb.toJSON();
    wb.clearHistory();
    expect(wb.sortColumnsBy(id, parseRange('A1:C2'), keys)).toBe(false);
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
  });

  it('refuses when columns carry different merges, but sorts columns whose merges match', () => {
    const uneven = book([[3, 1, 2], ['a', 'b', 'c'], ['d', 'e', 'f']]);
    uneven.wb.mergeCells(uneven.id, parseRange('A2:A3'));
    expect(uneven.wb.sortColumnsBy(uneven.id, parseRange('A1:C3'), keys)).toBe(false);
    expect([0, 1, 2].map((c) => uneven.wb.getValue(uneven.id, 0, c))).toEqual([3, 1, 2]);
    const even = book([[3, 1, 2], ['a', 'b', 'c'], ['d', 'e', 'f']]);
    for (const col of ['A', 'B', 'C']) even.wb.mergeCells(even.id, parseRange(`${col}2:${col}3`));
    expect(even.wb.sortColumnsBy(even.id, parseRange('A1:C3'), keys)).toBe(true);
    expect([0, 1, 2].map((c) => even.wb.getValue(even.id, 0, c))).toEqual([1, 2, 3]);
    expect([0, 1, 2].map((c) => even.wb.getValue(even.id, 1, c))).toEqual(['b', 'c', 'a']);
    expect(even.wb.sheet(even.id).merges).toHaveLength(3);
  });

  it('refuses a spilled array result across the columns', () => {
    const { wb, id } = book([[3, 1, 2]]);
    wb.setInput(id, 1, 0, '=SEQUENCE(1,3)');
    expect(wb.getValue(id, 1, 2)).toBe(3);
    const before = wb.toJSON();
    expect(wb.sortColumnsBy(id, parseRange('A1:C2'), keys)).toBe(false);
    expect(wb.toJSON()).toEqual(before);
    expect(wb.getCell(id, 1, 0).f).toBe('SEQUENCE(1,3)');
  });

  it('refuses a range that touches a table, whose header cells must stay put', () => {
    const { wb, id } = book([['Qty', 'Amt', 'Note'], [3, 1, 2]]);
    wb.addTable(id, parseRange('A1:B2'), { name: 'T' });
    wb.setInput(id, 5, 5, '=SUM(T[Qty])');
    expect(wb.sortColumnsBy(id, parseRange('A2:C2'), keys)).toBe(false);
    expect(wb.sortColumnsBy(id, parseRange('A1:C2'), keys)).toBe(false);
    expect(wb.tableColumns(id, wb.tableById(id, wb.tablesOn(id)[0].id))).toEqual(['Qty', 'Amt']);
    expect(wb.getValue(id, 5, 5)).toBe(3);
  });

  it('still sorts a plain range', () => {
    const { wb, id } = book([[3, 1, 2], ['c', 'a', 'b']]);
    expect(wb.sortColumnsBy(id, parseRange('A1:C2'), keys)).toBe(true);
    expect([0, 1, 2].map((c) => wb.getValue(id, 1, c))).toEqual(['a', 'b', 'c']);
  });
});
