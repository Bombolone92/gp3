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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'probability-tails');
}

it('preserves tail formulas, errors, edits and shifted copies across metadata-free XLSX saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  ['5e307', '4e-308', '1e-154'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const formulas = ['F.DIST.RT(A1,1,1)', 'F.DIST(A1,1,1,TRUE)', 'BETA.DIST(A2,1,0.5,TRUE)',
    '1e100*BETA.DIST(A3,2,1,TRUE)', 'F.DIST.RT(A1,4,2)', 'F.TEST({0,1e154},{1,2,3})', 'F.TEST({0,1.5e154},{0,1})'];
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const expected = [0, 1, 0, 1e-208, { error: '#DIV/0!' }, 0, { error: '#NUM!' }];
  const check = (r = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, r, c + 3);
    if (v === 1e-208) expect(actual / v).toBeCloseTo(1, 12);
    else expect(actual).toEqual(v);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 0, '4e307');
  expect(wb.getValue(id, 0, 3)).toBeGreaterThan(0);
  expect(typeof wb.getValue(id, 0, 7)).toBe('number');
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 9 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 3).f).toBe('F.DIST.RT(A11,1,1)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('uses externally pasted numeric values in underflow and power-path calculations', () => {
  const values = [[5e307], [4e-308], [1e-154]];
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    ['F.DIST.RT(A1,1,1)', 'BETA.DIST(A2,1,0.5,TRUE)', '1e100*BETA.DIST(A3,2,1,TRUE)']
      .forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    expect(wb.getValue(id, 0, 2)).toBe(0);
    expect(wb.getValue(id, 1, 2)).toBe(0);
    expect(wb.getValue(id, 2, 2) / 1e-208).toBeCloseTo(1, 12);
  } finally { vi.unstubAllGlobals(); }
});
