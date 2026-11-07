import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { styleToNumFmt } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

it.each([0, 2, 20])('preserves grouping and %s decimal places in exported format codes', (dec) => {
  const zeros = dec ? `.${'0'.repeat(dec)}` : '';
  expect(styleToNumFmt({ fmt: 'number', dec, group: false })).toBe(`0${zeros}`);
  expect(styleToNumFmt({ fmt: 'number', dec, group: true })).toBe(`#,##0${zeros}`);
  expect(styleToNumFmt({ fmt: 'number', dec })).toBe(`#,##0${zeros}`);
  expect(styleToNumFmt({ fmt: 'currency', dec, group: false })).toBe(`"$"0${zeros}`);
  expect(styleToNumFmt({ fmt: 'currency', dec })).toBe(`"$"#,##0${zeros}`);
  expect(styleToNumFmt({ fmt: 'percent', dec, group: false })).toBe(`0${zeros}%`);
  expect(styleToNumFmt({ fmt: 'percent', dec })).toBe(`#,##0${zeros}%`);
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('preserves thousands separators in %s files and when reopening them', async (extension, save) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const cases = [
    [{ fmt: 'number', dec: 2, group: false }, '1234.50', '0.00'],
    [{ fmt: 'number', dec: 0, group: false }, '1235', '0'],
    [{ fmt: 'number', dec: 2, group: true }, '1,234.50', '#,##0.00'],
    [{ fmt: 'number', dec: 2 }, '1,234.50', '#,##0.00'],
    [{ fmt: 'currency', dec: 2, group: false }, '$1234.50', '"$"0.00'],
    [{ fmt: 'currency', dec: 2 }, '$1,234.50', '"$"#,##0.00'],
    [{ fmt: 'percent', dec: 2, group: false }, '123450.00%', '0.00%'],
    [{ fmt: 'percent', dec: 2 }, '123,450.00%', '#,##0.00%'],
  ];
  for (const [r, [style, display]] of cases.entries()) {
    wb.setInput(id, r, 0, '1234.5');
    wb.setInput(id, r, 1, `=-A${r + 1}`);
    wb.applyStyle(id, { r1: r, c1: 0, r2: r, c2: 1 }, style);
    expect(wb.getDisplay(id, r, 0)).toBe(display);
  }
  const bytes = await (await save(wb)).arrayBuffer();
  const file = XLSX.read(bytes, { type: 'array', cellNF: true });
  const back = await workbookFromFile(bytes, `numbers.${extension}`);
  for (const [r, [, display, code]] of cases.entries()) {
    const sheet = file.Sheets[file.SheetNames[0]];
    expect(sheet[`A${r + 1}`].z).toBe(code);
    expect(sheet[`B${r + 1}`].z).toBe(code);
    expect(back.getDisplay(back.activeSheetId, r, 0)).toBe(display);
    expect(back.getDisplay(back.activeSheetId, r, 1)).toBe(`-${display}`);
    expect(back.getCell(back.activeSheetId, r, 1).f).toBe(`-A${r + 1}`);
  }
});
