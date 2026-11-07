import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([
  [{ fmt: 'percent', dec: 1 }, '#,##0.0%'],
  [{ fmt: 'custom', code: '0.00" kg"' }, '0.00" kg"'],
])('writes inherited spill number formats to XLSX and restores live inheritance (%j)', async (style, code) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const anchor = { r1: 0, r2: 0, c1: 0, c2: 0 };
  wb.setInput(id, 0, 0, '=SEQUENCE(5)');
  wb.applyStyle(id, anchor, style);
  wb.applyStyle(id, { r1: 2, r2: 2, c1: 0, c2: 0 }, { bold: true, dec: 3 });
  wb.applyStyle(id, { r1: 3, r2: 3, c1: 0, c2: 0 }, { fmt: 'custom', code: '0.0" lb"' });
  wb.applyStyle(id, { r1: 4, r2: 4, c1: 0, c2: 0 }, { fmt: 'general' });
  wb.setNote(id, 1, 0, 'Keep the note');
  const file = await workbookToXlsx(wb);
  const book = X.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
  const ws = book.Sheets[wb.sheet(id).name];
  expect(ws.A2.z).toBe(code);
  expect(ws.A3.z).toBe(style.fmt === 'percent' ? '#,##0.000%' : code);
  expect(ws.A4.z).toBe('0.0" lb"');
  expect(ws.A5.z).toBe('General');
  expect(ws.A2.v).toBe(2);
  expect(ws.A2.c[0].t).toBe('Keep the note');

  const back = await workbookFromFile(file, 'formats.xlsx');
  const bid = back.activeSheetId;
  expect([0, 1, 2, 3, 4].map((r) => back.getDisplay(bid, r, 0)))
    .toEqual([0, 1, 2, 3, 4].map((r) => wb.getDisplay(id, r, 0)));
  expect(back.getCell(bid, 1, 0)).toBeUndefined();
  expect(back.getCell(bid, 2, 0).s).toEqual({ bold: true, dec: 3 });
  back.applyStyle(bid, anchor, { fmt: 'number', dec: 2 });
  expect(back.getDisplay(bid, 1, 0)).toBe('2.00');
  expect(back.getDisplay(bid, 2, 0)).toBe('3.000');
  expect(back.getDisplay(bid, 3, 0)).toBe('4.0 lb');
  expect(back.getDisplay(bid, 4, 0)).toBe('5');
  back.undo();
  expect(back.getDisplay(bid, 1, 0)).toBe(wb.getDisplay(id, 1, 0));

  // An ordinary XLSX without the app's sidecar still uses its stored formats.
  const metaName = book.SheetNames.find((name) => name !== wb.sheet(id).name);
  delete book.Sheets[metaName];
  book.SheetNames = [wb.sheet(id).name];
  book.Workbook.Sheets = book.Workbook.Sheets.slice(0, 1);
  const external = await workbookFromFile(X.write(book, { type: 'array', bookType: 'xlsx' }), 'external.xlsx');
  expect(external.getDisplay(external.activeSheetId, 1, 0)).toBe(wb.getDisplay(id, 1, 0));
});
