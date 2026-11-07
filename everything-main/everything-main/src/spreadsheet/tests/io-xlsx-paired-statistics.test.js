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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'paired-statistics');
}

it('recalculates covariance and correlation after edits, Undo, shifted copies and metadata-free XLSX saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  [[0, 3e-154], [3e-154, 0], [0, 3e-154]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const formulas = ['COVARIANCE.P(A1:A3,B1:B3)', 'COVARIANCE.S(A1:A3,B1:B3)', 'CORREL(A1:A3,B1:B3)',
    'RSQ(A1:A3,B1:B3)', 'SLOPE(B1:B3,A1:A3)', 'INTERCEPT(B1:B3,A1:A3)', 'FORECAST.LINEAR(0,B1:B3,A1:A3)', 'STEYX(B1:B3,A1:A3)'];
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const expected = [0, 0, { error: '#NUM!' }, { error: '#NUM!' }, -1, 3e-154, 3e-154, 2e-154];
  const check = (row = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, row, c + 3);
    if (typeof v === 'number' && v !== 0) expect(actual / v).toBeCloseTo(1, 12);
    else expect(actual).toEqual(v);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 1, 0, '1e-153');
  expect(wb.getValue(id, 0, 3)).toBeLessThan(0);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 10 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 5).f).toBe('CORREL(A11:A13,B11:B13)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('uses externally pasted numeric values as paired observations', () => {
  const values = [[0, 4e-154], [4e-154, 0], [0, 4e-154]];
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    wb.setInput(id, 0, 3, '=COVARIANCE.S(A1:A3,B1:B3)*1e307');
    wb.setInput(id, 1, 3, '=CORREL(A1:A3,B1:B3)');
    expect(wb.getValue(id, 0, 3)).toBeCloseTo(-0.355555555555556, 13);
    expect(wb.getValue(id, 1, 3)).toBeCloseTo(-1, 13);
  } finally { vi.unstubAllGlobals(); }
});
