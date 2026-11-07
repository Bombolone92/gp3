import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['Price] USD', '[Cost]', '#Data', '@Rate', "Owner's amount", 'A,B', 'Amount'])(
  'keeps table totals valid for the literal column name %s', (label) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [['Item', label], ['A', 10], ['B', 20]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
    const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
    wb.clearHistory();
    wb.setTableTotals(id, tid, true);
    expect(wb.getValue(id, 3, 1)).toBe(30);
    wb.setInput(id, 1, 1, '40');
    expect(wb.getValue(id, 3, 1)).toBe(60);
    wb.undo();
    expect(wb.getValue(id, 3, 1)).toBe(30);
    wb.undo();
    expect(wb.getValue(id, 3, 1)).toBeNull();
    wb.redo();
    expect(wb.getValue(id, 3, 1)).toBe(30);
    wb.setInput(id, 0, 1, 'Renamed');
    expect(wb.getCell(id, 3, 1).f).toBe('SUBTOTAL(109,Sales[Renamed])');
    expect(wb.getValue(id, 3, 1)).toBe(30);
  },
);
