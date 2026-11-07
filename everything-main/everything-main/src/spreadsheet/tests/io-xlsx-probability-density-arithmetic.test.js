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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'probability-density');
}

it('preserves precise densities, raw-input errors and bounds through XLSX edits and copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  ['0.5', '0', '5e-155'].forEach((v, r) => wb.setInput(id, r, 0, v));
  const formulas = ['BETA.DIST(A1,500000,500000,FALSE)', 'T.DIST(A2,1e10,FALSE)',
    'BETA.DIST(A2,1,1,FALSE)', 'BETA.DIST(-3,1,1,FALSE,-3,7)',
    'BETA.DIST(A2,1,2,FALSE,-3,7)', 'BETA.DIST(A3*1e-10,3,1,FALSE,0,1e-10)'];
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const num = { error: '#NUM!' }, expected = [797.88436133175, 0.39894228039146, num, 0, num, 0];
  const check = (r = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, r, c + 3);
    if (typeof v === 'number' && v) expect(actual / v).toBeCloseTo(1, 12);
    else expect(actual).toEqual(v);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 1, 0, '0.25');
  expect(wb.getValue(id, 0, 5)).toBeCloseTo(1, 14);
  expect(wb.getValue(id, 0, 7)).toBeCloseTo(0.135, 14);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 8 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 7).f).toBe('BETA.DIST(A12,1,2,FALSE,-3,7)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('uses external numeric HTML inputs without losing density precision or error semantics', () => {
  const values = [[0.5], [0]];
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    ['BETA.DIST(A1,500000,500000,FALSE)', 'T.DIST(A2,1e10,FALSE)', 'BETA.DIST(A2,1,2,FALSE,-3,7)']
      .forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    expect(wb.getValue(id, 0, 2) / 797.88436133175).toBeCloseTo(1, 12);
    expect(wb.getValue(id, 1, 2)).toBeCloseTo(0.39894228039146, 14);
    expect(wb.getValue(id, 2, 2)).toEqual({ error: '#NUM!' });
  } finally { vi.unstubAllGlobals(); }
});
