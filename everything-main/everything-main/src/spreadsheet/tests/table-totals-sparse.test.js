import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('creates totals on a large sparse table without visiting its millions of empty cells', () => {
  const wb = new Workbook({ sheets: [{ name: 'Sparse', rows: 900002, cols: 20,
    cells: { '0,0': { v: 'Value' }, '500000,0': { v: 7 }, '899999,19': { v: 9 } },
  }] });
  const id = wb.activeSheetId;
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 900000, c2: 19 }, { name: 'SparseData' });
  wb.clearHistory();
  const before = wb.toJSON();
  const getValue = wb.getValue.bind(wb);
  let reads = 0;
  const spy = vi.spyOn(wb, 'getValue').mockImplementation((...args) => {
    if (++reads > 1000) throw new Error('Scanned empty cells instead of the stored data');
    return getValue(...args);
  });
  try {
    expect(() => wb.setTableTotals(id, tid, true)).not.toThrow();
    expect(reads).toBeLessThan(50);
    expect(wb.getCell(id, 900001, 0).f).toBe('SUBTOTAL(109,SparseData[Value])');
    expect(wb.getCell(id, 900001, 19).f).toBe('SUBTOTAL(109,SparseData[Column20])');
    expect(wb.tableById(id, tid).totalsRow).toBe(true);
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
  } finally { spy.mockRestore(); }
});

it('counts spill values once and retains numeric-column inference and formats', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: {
    '0,0': { v: 'Label' }, '0,1': { v: 'Spilled' }, '0,2': { v: 'Mixed' }, '0,3': { v: 'Half numeric' }, '0,4': { v: 'Empty' },
    '1,0': { v: 'A' }, '2,0': { v: 'B' },
    '1,1': { f: 'SEQUENCE(3)' }, '4,1': { s: { fmt: 'custom', code: '$0.00' } },
    '1,2': { v: true }, '2,2': { v: 'text' }, '3,2': { f: '1/0' }, '4,2': { v: 5 },
    '1,3': { v: 2 }, '2,3': { v: 'text' },
  } }] });
  const id = wb.activeSheetId;
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 4, c2: 4 }, { name: 'DataTable' });
  wb.setTableTotals(id, tid, true);
  expect(wb.getValue(id, 5, 0)).toBe('Total');
  expect(wb.getValue(id, 5, 1)).toBe(6);
  expect(wb.getCell(id, 5, 1).s).toMatchObject({ fmt: 'custom', code: '$0.00' });
  expect(wb.getCell(id, 5, 2)).toBeUndefined();
  expect(wb.getValue(id, 5, 3)).toBe(2);
  expect(wb.getCell(id, 5, 4)).toBeUndefined();
});
