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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'trimmean-arithmetic');
}

const values = [[9e307, 0.8], [0.1, 0], [true, null]];
const formulas = ['TRIMMEAN(A1*{1,1,-1},B1)', 'TRIMMEAN(A1*{1,1,0,-1,-1},B1)',
  '1*(TRIMMEAN(A2*SEQUENCE(5)^0,0.9)-A2)', 'TRIMMEAN(A3,0)', 'TRIMMEAN(A1*{1,-1,1},B2)'];
const expected = [{ error: '#NUM!' }, 0, 2.77555756156289e-17, { error: '#NUM!' }, 3e307];

function checkValue(actual, expected) {
  if (typeof expected === 'number' && expected !== 0) expect(actual / expected).toBeCloseTo(1, 12);
  else expect(actual).toEqual(expected);
}

it('preserves trimmed-mean arithmetic and reference input types, recalculation and shifted copies through native XLSX records', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v === null ? '' : String(v))));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => expected.forEach((v, c) => checkValue(wb.getValue(id, r, c + 3), v));
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 1, '0');
  expect(wb.getValue(id, 0, 4)).toEqual({ error: '#NUM!' });
  wb.undo(); check();
  wb.setInput(id, 2, 0, '2');
  expect(wb.getValue(id, 0, 6)).toBe(2);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 7 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 5).f).toBe('1*(TRIMMEAN(A12*SEQUENCE(5)^0,0.9)-A12)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains numeric and boolean inputs from external HTML for trimmed means', () => {
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
