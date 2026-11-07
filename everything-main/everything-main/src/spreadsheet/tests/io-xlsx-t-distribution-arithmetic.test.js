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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 't-distribution');
}

it('preserves one/two-sided tails, density subnormals and errors across XLSX edits and copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  ['6e153', '5e102', '8e153'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const formulas = ['T.DIST.RT(A1,2)', 'T.DIST.2T(A1,2)*(1e307*10)',
    'T.DIST(A2,2,FALSE)*(1e307*10)', 'T.DIST(A3,1,FALSE)', 'T.DIST.2T(1.5e154,3)',
    'TDIST(A1,2,1)', 'TDIST(A1,2,2)*(1e307*10)'];
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const expected = [0, 25 / 9, 0.8, { error: '#DIV/0!' }, { error: '#NUM!' }, 0, 25 / 9];
  const check = (r = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, r, c + 3);
    if (typeof v === 'number') expect(actual).toBeCloseTo(v, 12);
    else expect(actual).toEqual(v);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 2, 0, '7e153');
  expect(wb.getValue(id, 0, 6)).toBe(0);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 9 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 6).f).toBe('T.DIST(A13,1,FALSE)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains external numeric HTML inputs for tail and density calculations', () => {
  const values = [[6e153], [5e102]];
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    ['T.DIST.RT(A1,2)', 'T.DIST.2T(A1,2)*(1e307*10)', 'T.DIST(A2,2,FALSE)*(1e307*10)']
      .forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    expect(wb.getValue(id, 0, 2)).toBe(0);
    expect(wb.getValue(id, 1, 2)).toBeCloseTo(25 / 9, 12);
    expect(wb.getValue(id, 2, 2)).toBeCloseTo(0.8, 12);
  } finally { vi.unstubAllGlobals(); }
});
