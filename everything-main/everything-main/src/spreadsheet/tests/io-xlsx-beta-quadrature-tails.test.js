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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'beta-quadrature-tails');
}

const formulas = ['BETA.DIST(A1,1000000,1000,TRUE)', 'F.DIST.RT(1000*(1-A1)/A1,2000,2000000)',
  'F.DIST(A1/(1000*(1-A1)),2000000,2000,TRUE)', 'BETA.DIST(A2,500000,500000,TRUE)'];
const values = [[0.99734834289652], [0.48121867258419]];
const expected = 6.0389869744298e-298;

it('preserves nonzero skew tails and underflow through XLSX edits and internal copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach(([v], r) => wb.setInput(id, r, 0, String(v)));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => {
    for (let c = 3; c < 6; c++) expect(wb.getValue(id, r, c) / expected).toBeCloseTo(1, 11);
    expect(wb.getValue(id, r, 6)).toBe(0);
  };
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 0, '0.5');
  for (let c = 3; c < 6; c++) expect(wb.getValue(id, 0, c)).toBe(0);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 1, c2: 6 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 4).f).toBe('F.DIST.RT(1000*(1-A11)/A11,2000,2000000)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('recalculates extreme beta and F tails from external HTML numeric inputs', () => {
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    formulas.forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    for (let r = 0; r < 3; r++) expect(wb.getValue(id, r, 2) / expected).toBeCloseTo(1, 11);
    expect(wb.getValue(id, 3, 2)).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});
