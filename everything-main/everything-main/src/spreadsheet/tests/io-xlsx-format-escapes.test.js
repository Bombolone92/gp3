import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([
  ['_x0041_', '_x005F_x0041_'],
  ['_x005F_', '_x005F_x005F_'],
  ['_x005F_x0041_', '_x005F_x005F_x005F_x0041_'],
  ['_x0041_x0042_', '_x005F_x0041_x005F_x0042_'],
  ['_x0041__x0042_', '_x005F_x0041__x005F_x0042_'],
  ['_X00aF_', '_x005F_X00aF_'],
  ['_xD83D__xDE00_', '_x005F_xD83D__x005F_xDE00_'],
  ['&_x003C_<', '&amp;_x005F_x003C_&lt;'],
  ['_x123_', '_x123_'],
  ['_xGGGG_', '_xGGGG_'],
  ['normal_text', 'normal_text'],
  ['\r_x000D_', '_x000d__x005F_x000D_'],
  ['\n_x000A_', '_x000a__x005F_x000A_'],
  ['\t_x0009_', '_x0009__x005F_x0009_'],
])('preserves literal and actual characters in XLSX format codes: %j', async (literal, encoded) => {
  const code = `0.00" ${literal}"`;
  let wb = new Workbook();
  wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 7.5, s: { fmt: 'custom', code } } }]);
  const expected = wb.getDisplay(wb.activeSheetId, 0, 0);
  for (let round = 0; round < 3; ++round) {
    const data = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const zip = XLSX.CFB.read(data, { type: 'array' });
    const xml = new TextDecoder().decode(zip.FileIndex.find((entry) => entry.name === 'styles.xml').content);
    expect(xml).toContain(`formatCode="0.00&quot; ${encoded}&quot;"`);
    const raw = XLSX.read(data, { type: 'array', cellNF: true });
    expect(raw.Sheets[raw.SheetNames[0]].A1.z).toBe(code);
    wb = await workbookFromFile(data, 'formats.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(7.5);
    expect(wb.getCell(wb.activeSheetId, 0, 0).s.code).toBe(code);
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe(expected);
  }
});

it.each([
  ['_x0041_', 'A'],
  ['_x005F_x0041_', '_x0041_'],
  ['_x000d_', '\r'],
])('still decodes genuine external Xstring escapes: %s', async (encoded, literal) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', v: 7.5, z: '0.00" SENTINEL"' } }, 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((entry) => entry.name === 'styles.xml');
  const xml = new TextDecoder().decode(entry.content).replaceAll('SENTINEL', encoded);
  entry.content = new TextEncoder().encode(xml);
  entry.size = entry.content.length;
  const wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(wb.getCell(wb.activeSheetId, 0, 0).s.code).toBe(`0.00" ${literal}"`);
  expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe(`7.50 ${literal}`);
});
