import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { dateTimeKind, editText, styleToNumFmt } from '../src/core/format.js';
import { codeColor } from '../src/core/numfmt.js';
import { cloneCell } from '../src/core/workbook.js';

function file(code) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[42.5, 'Keep this text', 85]]);
  sheet.C1.f = 'A1*2';
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  const style = { fmt: 'custom', code, bold: true };
  const meta = { v: 1, sheets: { Data: { styles: { '0,0': style, '0,1': style } } } };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[JSON.stringify(meta)]]), META_SHEET);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

it.each([42, true, {}, { toString: null }, ['0.00'], ['yyyy-mm-dd'], ['[Red]0'], [';;;"Label: "@'], null].map((code) => ({ code })))(
  'ignores malformed custom-format code $code when importing, editing, and saving', async ({ code }) => {
    const wb = await workbookFromFile(file(code), 'metadata.xlsx');
    for (const roundTrip of [false, true]) {
      const back = roundTrip ? await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx') : wb;
      const id = back.activeSheetId;
      const cell = back.getCell(id, 0, 0);
      expect(back.getDisplay(id, 0, 0)).toBe('42.5');
      expect(back.getDisplay(id, 0, 1)).toBe('Keep this text');
      expect(back.getValue(id, 0, 2)).toBe(85);
      expect(cell.s.bold).toBe(true);
      expect(editText(cell)).toBe('42.5');
      expect(dateTimeKind(cell.s, cell.v)).toBeNull();
      expect(codeColor(cell.v, cell.s.code)).toBeNull();
      expect(styleToNumFmt(cell.s)).toBe('General');
    }
  },
);

it('preserves valid custom formatting through an XLSX round trip', async () => {
  const code = '[Red]0.00;[Blue]-0.00;0;"Label: "@';
  const wb = await workbookFromFile(file(code), 'custom.xlsx');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('42.50');
  expect(back.getDisplay(back.activeSheetId, 0, 1)).toBe('Label: Keep this text');
  expect(back.getCell(back.activeSheetId, 0, 0).s.code).toBe(code);
});

it('discards invalid codes without modifying the source cell or other style fields', () => {
  const cell = { v: 42.5, s: { fmt: 'custom', code: { toString: null }, bold: true } };
  const copy = cloneCell(cell);
  expect(copy.s).toEqual({ fmt: 'custom', bold: true });
  expect(cell.s.code).toEqual({ toString: null });
  for (const code of ['', '0', 'yyyy-mm-dd', ';;;']) {
    expect(cloneCell({ ...cell, s: { ...cell.s, code } }).s.code).toBe(code);
  }
});
