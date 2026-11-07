import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

function book() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'key');
  wb.setInput(id, 1, 0, 'empty text');
  wb.setInput(id, 1, 1, '=""');
  return { wb, id };
}

it('materializes empty references as zero while preserving intentional empty text', () => {
  const { wb, id } = book();
  const formulas = ['B1', 'INDEX(B1:B2,1)', 'IFERROR(INDEX(A1:B2,1,2),"")', 'IF(TRUE,B1,7)', 'INDIRECT("B1")',
    'VLOOKUP("key",A1:B2,2,FALSE)', 'HLOOKUP("key",A1:B2,2,FALSE)', 'XLOOKUP("key",A1:A2,B1:B2)',
    'ISBLANK(B1)', 'ISBLANK(INDEX(B1:B2,1))', 'COUNT(INDEX(B1:B2,1))', 'ISBLANK(VLOOKUP("key",A1:B2,2,FALSE))',
    'VLOOKUP("key",A1:B2,2,FALSE)=""', 'B2', 'IFERROR(1/0,"")', 'VLOOKUP("empty text",A1:B2,2,FALSE)'];
  formulas.forEach((f, r) => wb.setInput(id, r, 3, `=${f}`));
  // HLOOKUP's selected A2 contains text; the others select the empty B1.
  expect(formulas.map((_, r) => wb.getValue(id, r, 3))).toEqual([0, 0, 0, 0, 0, 0, 'empty text', 0, true, true, 0, false, false, '', '', '']);
  expect(wb.getValue(id, 0, 1)).toBeNull();
  wb.setInput(id, 0, 4, '=ISBLANK(D1)');
  expect(wb.getValue(id, 0, 4)).toBe(false);
});

it('spills zeros without mutating source blanks or turning empty strings into numbers', () => {
  const { wb, id } = book();
  wb.setInput(id, 0, 3, '=B1:B3');
  expect(wb.rangeValues(id, { r1: 0, c1: 3, r2: 2, c2: 3 })).toEqual([[0], [''], [0]]);
  wb.setInput(id, 0, 5, '=ISBLANK(B1:B3)');
  expect(wb.rangeValues(id, { r1: 0, c1: 5, r2: 2, c2: 5 })).toEqual([[true], [false], [true]]);
  wb.setInput(id, 0, 7, '=COUNT(D1#)');
  wb.setInput(id, 1, 7, '=COUNTA(D1#)');
  wb.setInput(id, 2, 7, '=ISBLANK(D3)');
  expect([0, 1, 2].map(r => wb.getValue(id, r, 7))).toEqual([2, 3, false]);
  wb.setInput(id, 0, 1, '12');
  expect(wb.getValue(id, 0, 3)).toBe(12);
  wb.undo();
  expect(wb.getValue(id, 0, 3)).toBe(0);
});

it('exports numeric zero caches and keeps blank results correct after save/reopen', async () => {
  const { wb, id } = book();
  wb.setInput(id, 0, 3, '=IFERROR(INDEX(B1:B2,1),"")');
  wb.setInput(id, 1, 3, '=VLOOKUP("key",A1:B2,2,FALSE)');
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const raw = X.read(bytes, { type: 'array' }).Sheets[wb.sheets[0].name];
  expect(raw.D1).toMatchObject({ t: 'n', v: 0 });
  expect(raw.D2).toMatchObject({ t: 'n', v: 0 });
  const reopened = await workbookFromFile(bytes, 'results.xlsx');
  expect(reopened.getValue(reopened.activeSheetId, 0, 3)).toBe(0);
  expect(reopened.getValue(reopened.activeSheetId, 1, 3)).toBe(0);
});
