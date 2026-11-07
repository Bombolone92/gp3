import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Amt'], [1, 10], [3, 30]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  wb.addTable(id, parseRange('A1:B3'), { name: 'T' });
  wb.defineName('QtyTotal', 'SUM(T[Qty])');
  wb.defineName('Both', 'SUM(T[[Qty]:[Amt]])', wb.sheet(id).name);
  wb.defineName('Plain', 'Sheet1!$A$2:$A$3');
  wb.setInput(id, 5, 5, '=QtyTotal');
  wb.setInput(id, 6, 5, '=Both');
  expect(wb.getValue(id, 5, 5)).toBe(4);
  expect(wb.getValue(id, 6, 5)).toBe(44);
  wb.clearHistory();
  return { wb, id };
}

const refOf = (wb, name) => wb.names.find((n) => n.name === name).ref;

describe('renaming a table column', () => {
  it('follows the rename into defined names when the header is typed', () => {
    const { wb, id } = setup();
    const before = wb.toJSON();
    wb.setInput(id, 0, 0, 'Count');
    expect(refOf(wb, 'QtyTotal')).toBe('SUM(T[Count])');
    expect(refOf(wb, 'Both')).toBe('SUM(T[[Count]:[Amt]])');
    expect(refOf(wb, 'Plain')).toBe('Sheet1!$A$2:$A$3');
    expect(wb.getValue(id, 5, 5)).toBe(4);
    expect(wb.getValue(id, 6, 5)).toBe(44);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    expect(wb.getValue(id, 5, 5)).toBe(4);
  });

  it('follows the rename into defined names when the header is pasted', () => {
    const { wb, id } = setup();
    wb.pasteCells(id, [[{ v: 'Count', f: null }, { v: 'Amount', f: null }]], 0, 0, { r: 9, c: 0 });
    expect(refOf(wb, 'QtyTotal')).toBe('SUM(T[Count])');
    expect(refOf(wb, 'Both')).toBe('SUM(T[[Count]:[Amount]])');
    expect(wb.getValue(id, 5, 5)).toBe(4);
    expect(wb.getValue(id, 6, 5)).toBe(44);
  });
});
