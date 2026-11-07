import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount'], ['A', 10], ['B', 20], ['C', 30]].flatMap((row, r) => row.map((v, c) => ({ r: r + 2, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 2, c1: 0, r2: 5, c2: 1 }, { name: 'Sales', totalsRow: true });
  const summary = wb.addSheet('Summary').id;
  wb.setInput(summary, 0, 0, '=SUM(Sales[Amount])');
  expect(wb.getValue(summary, 0, 0)).toBe(60);
  expect(wb.getValue(id, 6, 1)).toBe(60);
  wb.clearHistory();
  return { wb, id, tid, summary };
}

it.each([[6, 1, 60, 5], [5, 2, 30, 4], [6, 3, 60, 5]])(
  'deleting rows at %i (%i) removes totals without consuming surviving data', (at, count, sum, end) => {
    const { wb, id, tid, summary } = setup();
    // Undo restores serialized sheets and normalizes optional empty metadata.
    const before = new Workbook(wb.toJSON()).toJSON();
    wb.deleteRows(id, at, count);
    expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: false, range: { r1: 2, c1: 0, r2: end, c2: 1 } });
    expect(wb.getValue(summary, 0, 0)).toBe(sum);
    const after = wb.toJSON();
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    expect(wb.getValue(id, 6, 1)).toBe(60);
    wb.redo();
    expect(wb.toJSON()).toEqual(after);
    wb.setTableTotals(id, tid, true);
    expect(wb.getValue(id, end + 1, 1)).toBe(sum);
    expect(wb.getValue(summary, 0, 0)).toBe(sum);
  },
);

it('keeps an existing totals row when all data rows are deleted, including after adding new data', () => {
  const { wb, id, tid, summary } = setup();
  wb.deleteRows(id, 3, 3);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: true, range: { r1: 2, c1: 0, r2: 3, c2: 1 } });
  expect(wb.getCell(id, 3, 1).f).toBe('SUBTOTAL(109,Sales[Amount])');
  const row = wb.addTableRow(id, tid);
  expect(row).toBe(3);
  wb.setInput(id, row, 1, '7');
  expect(wb.getValue(id, 4, 1)).toBe(7);
  expect(wb.getValue(summary, 0, 0)).toBe(7);
});

it('keeps totals when deleting rows above the table', () => {
  const { wb, id, tid, summary } = setup();
  wb.deleteRows(id, 0, 2);
  expect(wb.tableById(id, tid)).toMatchObject({ totalsRow: true, range: { r1: 0, c1: 0, r2: 4, c2: 1 } });
  expect(wb.getValue(id, 4, 1)).toBe(60);
  expect(wb.getValue(summary, 0, 0)).toBe(60);
});
