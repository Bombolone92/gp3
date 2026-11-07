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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'ttest-sample-moments');
}

const values = [[9e307], [0], [0]];
const formulas = ['T.TEST(A1*{1,1},A2:A3,2,3)', 'T.TEST(A1*{1,1},A2,2,2)',
  'T.TEST(A1*{1,1},B1:B2,2,3)', 'TTEST(A2:A3,A1*{1,1},1,3)', 'T.TEST(1e154*{1,-1,0},A2,2,3)'];
const expected = [{ error: '#NUM!' }, { error: '#NUM!' }, { error: '#DIV/0!' }, { error: '#NUM!' }, { error: '#NUM!' }];

function checkValue(actual, expected) {
  if (typeof expected === 'number') expect(actual).toBeCloseTo(expected, 14);
  else expect(actual).toEqual(expected);
}

it('preserves t-test sample moment errors, recalculation and shifted copies through native XLSX records', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach(([v], r) => wb.setInput(id, r, 0, String(v)));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => expected.forEach((v, c) => checkValue(wb.getValue(id, r, c + 3), v));
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 0, '8e307');
  expect(wb.getValue(id, 0, 3)).toEqual({ error: '#DIV/0!' });
  expect(wb.getValue(id, 0, 6)).toEqual({ error: '#DIV/0!' });
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 7 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 5).f).toBe('T.TEST(A11*{1,1},B11:B12,2,3)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains large numeric inputs from external HTML across the sample sum overflow boundary', () => {
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
