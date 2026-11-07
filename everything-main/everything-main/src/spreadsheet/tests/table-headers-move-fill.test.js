import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

/** Table T over A1:B3 (Qty, Amt) with a formula and a rule that name its columns. */
function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Amt'], [1, 10], [3, 30]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const table = wb.addTable(id, parseRange('A1:B3'), { name: 'T' });
  wb.setInput(id, 5, 5, '=SUM(T[Amt])');
  wb.addRule(id, { type: 'formula', range: parseRange('B2:B3'), value: '=[@Amt]>20', style: { bold: true } });
  expect(wb.getValue(id, 5, 5)).toBe(40);
  wb.clearHistory();
  return { wb, id, table };
}
const columns = (wb, id, table) => wb.tableColumns(id, wb.tableById(id, table));

describe('table headers written by moving or filling cells', () => {
  it('renames the column when a moved cell lands on the header', () => {
    const { wb, id, table } = setup();
    wb.setInput(id, 8, 8, 'Amount');
    const before = wb.toJSON();
    wb.clearHistory();
    expect(wb.moveRange(id, parseRange('I9'), 0, 1)).toEqual(parseRange('B1'));
    expect(columns(wb, id, table)).toEqual(['Qty', 'Amount']);
    expect(wb.getCell(id, 5, 5).f).toBe('SUM(T[Amount])');
    expect(wb.getValue(id, 5, 5)).toBe(40);
    expect(wb.sheet(id).rules[0].value).toBe('=[@Amount]>20');
    expect(wb.conditionalStyle(id, 2, 1, 30)?.bold).toBe(true);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
  });

  it('keeps headers distinct when a header is filled across, and renames what a fill writes over a header', () => {
    const { wb, id, table } = setup();
    wb.fill(id, parseRange('A1'), parseRange('A1:B1'));
    expect(columns(wb, id, table)).toEqual(['Qty', 'Qty2']);
    expect(wb.getCell(id, 5, 5).f).toBe('SUM(T[Qty2])');
    expect(wb.getValue(id, 5, 5)).toBe(40);
    expect(wb.sheet(id).rules[0].value).toBe('=[@Qty2]>20');
  });

  it('renames the column when Ctrl+Enter writes the header', () => {
    const { wb, id, table } = setup();
    wb.fillInput(id, parseRange('B1'), 'Total', { r: 0, c: 1 });
    expect(columns(wb, id, table)).toEqual(['Qty', 'Total']);
    expect(wb.getCell(id, 5, 5).f).toBe('SUM(T[Total])');
    expect(wb.getValue(id, 5, 5)).toBe(40);
    wb.fillInput(id, parseRange('A1:B1'), 'Same', { r: 0, c: 0 });
    expect(columns(wb, id, table)).toEqual(['Same', 'Same2']);
    expect(wb.getCell(id, 5, 5).f).toBe('SUM(T[Same2])');
  });
});
