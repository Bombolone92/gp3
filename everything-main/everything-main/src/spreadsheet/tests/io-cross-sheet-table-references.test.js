import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([false, true])(
  'retains table references on a sheet without tables in XLSX with protection %s', async (protectedSheet) => {
    let wb = new Workbook(), source = wb.activeSheetId;
    wb.renameSheet(source, "Source's data");
    wb.setCells(source, [['Qty', 'Amount'], [2, 4], [3, 6]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
    wb.addTable(source, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
    let summary = wb.addSheet('Summary').id;
    wb.setInput(summary, 0, 0, '=SUM(Sales[Amount])');
    wb.setInput(summary, 1, 0, '=SUM(Sales[Qty])*2');
    wb.setInput(summary, 2, 0, '=A1+1');
    wb.setSheetProtected(summary, protectedSheet);
    for (let round = 0; round < 2; round++) {
      const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
      wb = await workbookFromFile(bytes, 'tables.xlsx');
      source = wb.sheetByName("Source's data").id;
      summary = wb.sheetByName('Summary').id;
      expect(wb.tablesOn(summary)).toEqual([]);
      expect(wb.getCell(summary, 0, 0).f).toBe('SUM(Sales[Amount])');
      expect(wb.getCell(summary, 1, 0).f).toBe('SUM(Sales[Qty])*2');
      expect(wb.getCell(summary, 2, 0).f).toBe('A1+1');
      expect(wb.isProtected(summary)).toBe(protectedSheet);
      expect([0, 1, 2].map((r) => wb.getValue(summary, r, 0))).toEqual([10, 10, 11]);
    }
    wb.setInput(source, 0, 1, 'Revenue');
    expect(wb.getCell(summary, 0, 0).f).toBe('SUM(Sales[Revenue])');
    const row = wb.addTableRow(source, wb.tableByName('Sales').table.id);
    wb.setInput(source, row, 0, '4'); wb.setInput(source, row, 1, '8');
    expect([0, 1, 2].map((r) => wb.getValue(summary, r, 0))).toEqual([18, 18, 19]);
  });

it('preserves unresolved table formulas in XLSX when the workbook has no tables yet', async () => {
  const original = new Workbook(), id = original.activeSheetId;
  original.setInput(id, 0, 0, '=SUM(Future[Amount])');
  const bytes = await (await workbookToXlsx(original)).arrayBuffer();
  const wb = await workbookFromFile(bytes, 'future.xlsx'), target = wb.activeSheetId;
  expect(wb.getCell(target, 0, 0).f).toBe('SUM(Future[Amount])');
  wb.setInput(target, 0, 2, 'Amount'); wb.setInput(target, 1, 2, '5');
  wb.addTable(target, { r1: 0, c1: 2, r2: 1, c2: 2 }, { name: 'Future' });
  expect(wb.getValue(target, 0, 0)).toBe(5);
});
