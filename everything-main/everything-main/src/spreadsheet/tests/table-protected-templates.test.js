import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['table rename', 'header rename', 'header paste', 'input move', 'convert'])(
  'maintains protected calculated-column templates after %s', (action) => {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Amount'); wb.setInput(id, 1, 0, '4'); wb.setInput(id, 2, 0, '6');
    wb.setInput(id, 0, 5, '10');
    const source = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Sales' });
    const other = wb.addSheet('Summary').id;
    wb.setCells(other, [['Qty', 'Total'], [2, null], [3, null]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
    const dependent = wb.addTable(other, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'SummaryTable' });
    wb.setInput(other, 1, 1, action === 'input move' ? '=[@Qty]*Sheet1!$F$1' : '=[@Qty]*SUM(Sales[Amount])');
    wb.setSheetProtected(other, true);
    wb.clearHistory();
    const before = wb.toJSON(), refused = [];
    wb.addEventListener('change', (event) => { if (event.detail.type === 'protected') refused.push(event.detail); });
    if (action === 'table rename') wb.updateTable(id, source, { name: 'Orders' });
    if (action === 'header rename') wb.setInput(id, 0, 0, 'Revenue');
    if (action === 'header paste') wb.pasteValues(id, [['Revenue']], 0, 0);
    if (action === 'input move') wb.moveRange(id, { r1: 0, c1: 5, r2: 0, c2: 5 }, 0, 6);
    if (action === 'convert') wb.deleteTable(id, source);
    expect(wb.getValue(other, 1, 1)).toBe(20);
    expect(wb.getValue(other, 2, 1)).toBe(30);
    expect(wb.tableById(other, dependent).calc[1]).toBe(wb.getCell(other, 1, 1).f);
    expect(refused).toEqual([]);
    expect(wb.isProtected(other)).toBe(true);
    expect(wb.undoLabels()).toHaveLength(1);
    const after = wb.toJSON();
    // Automatic maintenance must not enable direct table or cell edits.
    expect(wb.updateTable(other, dependent, { name: 'Changed', style: 'red' })).toBe(false);
    wb.setInput(other, 1, 1, '=99');
    expect(wb.toJSON()).toEqual(after);
    wb.undo(); expect(wb.toJSON()).toEqual(before);
    wb.redo(); expect(wb.toJSON()).toEqual(after);
    wb.setSheetProtected(other, false);
    const row = wb.addTableRow(other, dependent);
    wb.setInput(other, row, 0, '7');
    expect(wb.getValue(other, row, 1)).toBe(70);
  });
