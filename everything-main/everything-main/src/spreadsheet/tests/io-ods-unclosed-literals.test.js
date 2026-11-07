import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookToXlsx, workbookFromFile } from '../src/core/io.js';

// The ODS writer refuses a custom code whose quoted literal has no closing quote, and one
// such cell failed the whole export. On screen the literal runs to the end of the code,
// and the file closes it there; a quote inside a bracket, which the writer cannot place,
// leaves the cell as General rather than failing the save.
it.each(['0 "abc', '0 "abc;0', '[Red]0 "x', 'hh["unfinished]', '[Red"]0', '0\\"x', '"a"[x"]'])('exports a cell formatted %j to .ods', async (code) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code });
  wb.setInput(id, 1, 0, '=SEQUENCE(2)');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'custom', code });
  const back = await workbookFromFile(await workbookToOds(wb), 'literal.ods');
  const bid = back.activeSheetId;
  expect(back.getValue(bid, 0, 0)).toBe(5);
  expect(back.getValue(bid, 2, 0)).toBe(2);
  // The .xlsx keeps the code as typed.
  const xlsx = await workbookFromFile(await workbookToXlsx(wb), 'literal.xlsx');
  expect(xlsx.getCell(xlsx.activeSheetId, 0, 0).s.code).toBe(code);
});
