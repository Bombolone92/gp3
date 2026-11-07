import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [['Qty', 'Amount'], [2, 4], [3, 6]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const table = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  return { wb, id, table };
}

it('anchors converted table ranges while keeping pre-existing A1 references relative', () => {
  const { wb, id, table } = setup();
  wb.setInput(id, 7, 0, '1'); wb.setInput(id, 8, 1, '100');
  wb.setInput(id, 0, 5, '=SUM(Sales[Amount])+A8');
  wb.clearHistory();
  const before = wb.toJSON();
  wb.deleteTable(id, table);
  const converted = wb.getCell(id, 0, 5).f;
  expect(converted).toBe('SUM($B$2:$B$3)+A8');
  expect(wb.getValue(id, 0, 5)).toBe(11);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.getCell(id, 0, 5).f).toBe(converted);
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 5, r2: 0, c2: 5 }), 1, 6, { r: 0, c: 5 });
  expect(wb.getCell(id, 1, 6).f).toBe('SUM($B$2:$B$3)+B9');
  expect(wb.getValue(id, 1, 6)).toBe(110);
});

it('converts each this-row reference to its own absolute cells', () => {
  const { wb, id, table } = setup();
  wb.setInput(id, 1, 1, '=[@Qty]*2');
  wb.setInput(id, 2, 1, '=[@Qty]*2');
  wb.deleteTable(id, table);
  expect(wb.getCell(id, 1, 1).f).toBe('$A$2*2');
  expect(wb.getCell(id, 2, 1).f).toBe('$A$3*2');
  wb.pasteCells(id, wb.copyRange(id, { r1: 1, c1: 1, r2: 2, c2: 1 }), 4, 3, { r: 1, c: 1 });
  expect([4, 5].map((r) => wb.getValue(id, r, 3))).toEqual([4, 6]);
});

it.each([false, true])('preserves native table references until conversion to a range: %s', async (converted) => {
  const { wb, id, table } = setup();
  wb.renameSheet(id, "Source's data");
  const summary = wb.addSheet('Summary').id;
  wb.setInput(summary, 0, 0, '=SUM(Sales[Amount])');
  if (converted) wb.deleteTable(id, table);
  const original = wb.getCell(summary, 0, 0).f;
  const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
  expect(wb.getCell(summary, 0, 0).f).toBe(original);
  const file = XLSX.read(bytes, { type: 'array' });
  expect(file.Sheets.Summary.A1.f).toBe(converted ? "SUM('Source''s data'!$B$2:$B$3)" : 'SUM(Sales[Amount])');
  const restored = await workbookFromFile(bytes, 'tables.xlsx');
  const target = restored.sheetByName('Summary').id;
  expect(restored.getCell(target, 0, 0).f).toBe(converted ? "SUM('Source''s data'!$B$2:$B$3)" : 'SUM(Sales[Amount])');
  expect(restored.getValue(target, 0, 0)).toBe(10);
});
