import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Tracing precedents and dependents read only A1 references and names, so a
// formula over a table column, or a [@Column] cell in a calculated column,
// showed no precedents and none of the table's cells found its dependents.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['H1', 'H2'], [1, 2], [3, 4]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.addTable(id, parseRange('A1:B3'), { name: 'TB' });
  wb.setInput(id, 5, 0, '=SUM(TB[H1])');
  wb.setInput(id, 1, 1, '=[@H1]*2');
  return { wb, id };
}
const at = (list) => list.map((x) => `${x.r},${x.c}`);

describe('tracing structured references', () => {
  it('lists the cells a table column or [@Column] reference reads', () => {
    const { wb, id } = book();
    expect(at(wb.precedents(id, 5, 0))).toEqual(['1,0', '2,0']);
    expect(at(wb.precedents(id, 1, 1))).toEqual(['1,0']);
    wb.setInput(id, 2, 1, '=[@H1]*3');
    expect(at(wb.precedents(id, 2, 1))).toEqual(['2,0']);
  });

  it('finds the formulas that read a table cell, on other sheets too', () => {
    const { wb, id } = book();
    const other = wb.addSheet('Other');
    wb.setInput(other.id, 0, 0, '=ROWS(TB[#All])');
    expect(wb.dependents(id, 1, 0)).toEqual([{ sheetId: id, r: 1, c: 1 }, { sheetId: id, r: 5, c: 0 }, { sheetId: other.id, r: 0, c: 0 }]);
    expect(wb.dependents(id, 0, 1)).toEqual([{ sheetId: other.id, r: 0, c: 0 }]);
    expect(at(wb.precedents(other.id, 0, 0))).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
    expect(wb.precedents(other.id, 0, 0).every((x) => x.sheetId === id)).toBe(true);
  });

  it('skips a reference to a column or table that does not exist', () => {
    const { wb, id } = book();
    wb.setInput(id, 6, 0, '=SUM(TB[Nope])+SUM(Missing[H1])');
    expect(wb.precedents(id, 6, 0)).toEqual([]);
  });
});
