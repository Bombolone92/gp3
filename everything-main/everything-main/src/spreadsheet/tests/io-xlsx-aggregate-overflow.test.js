import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

async function nativeOnly(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'aggregate-overflow');
}

const values = [[9e307, 'yes'], [9e307, 'yes'], [-9e307, 'yes']];
const formulas = ['SUM(A1:A3)', 'AVERAGE(A1:A3)', 'SUMPRODUCT(A1:A3)',
  'AVERAGEIF(B1:B3,"yes",A1:A3)', 'SUMIFS(A1:A3,B1:B3,"yes")', 'AGGREGATE(9,0,A1:A3)', 'SUM(A1,A3,A2)'];
const expected = [...Array.from({ length: 6 }, () => ({ error: '#NUM!' })), 9e307];

function checkValue(actual, expected) {
  expect(actual).toEqual(expected);
}

it('preserves aggregate overflow and cancellation order, recalculation and shifted copies through native XLSX records', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => expected.forEach((v, c) => checkValue(wb.getValue(id, r, c + 3), v));
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 1, 0, '0');
  expect(wb.getValue(id, 0, 3)).toBe(0);
  expect(wb.getValue(id, 0, 6)).toBe(0);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 9 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 6).f).toBe('AVERAGEIF(B11:B13,"yes",A11:A13)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains large numeric inputs and criteria from external HTML for aggregate overflow', () => {
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    formulas.forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    expected.forEach((v, r) => checkValue(wb.getValue(id, r, 2), v));
  } finally { vi.unstubAllGlobals(); }
});
