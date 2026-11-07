import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { workbookToXlsx, workbookToOds, workbookFromFile } from '../src/core/io.js';

// A row height or hidden line far down the sheet used to fill the layout arrays up to
// its index, so every save wrote a record for each of a million rows (7 MB for one
// cell) and the .ods writer ran out of memory building a style for each of them.
it('saves a far-off row height and hidden lines without a record for every line before them', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, MAX_ROWS, MAX_COLS);
  wb.setInput(id, 0, 0, 'x');
  wb.setRowHeight(id, MAX_ROWS - 1, 40);
  wb.setHidden(id, 'row', [MAX_ROWS - 2], true);
  wb.setHidden(id, 'col', [MAX_COLS - 1], true);
  const xlsx = await workbookToXlsx(wb);
  expect(xlsx.size).toBeLessThan(20_000);
  const back = await workbookFromFile(await xlsx.arrayBuffer(), 'far.xlsx');
  const bid = back.activeSheetId;
  expect(back.getValue(bid, 0, 0)).toBe('x');
  expect(back.rowHeight(bid, MAX_ROWS - 1)).toBe(40);
  expect(back.rowHeight(bid, 5)).toBe(wb.rowHeight(id, 5));
  expect(back.isRowHidden(bid, MAX_ROWS - 2)).toBe(true);
  expect(back.isRowHidden(bid, 5)).toBe(false);
  expect(back.sheets[0].hiddenCols.has(MAX_COLS - 1)).toBe(true);
  expect(back.sheets[0].hiddenCols.size).toBe(1);
  const ods = await workbookToOds(wb);
  expect(ods.size).toBeLessThan(20_000);
  const fromOds = await workbookFromFile(await ods.arrayBuffer(), 'far.ods');
  expect(fromOds.getValue(fromOds.activeSheetId, 0, 0)).toBe('x');
  expect(fromOds.sheets[0].hiddenCols.has(MAX_COLS - 1)).toBe(true);
});
