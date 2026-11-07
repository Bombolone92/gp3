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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'beta-unit-shapes');
}

const values = [[0.9], [0.5]];
const formulas = ['BETA.DIST(A1,1000,1,TRUE)', 'BINOM.DIST(0,1000,1-A1,TRUE)',
  'BETA.DIST(A2,1,1e-16,TRUE)', 'F.TEST(SQRT(1000*(1-A1)/A1*VAR.S(SEQUENCE(2001)))*{-1,0,1},SEQUENCE(2001))',
  'F.DIST.RT(1000*(1-A1)/A1,2,2000)', 'BETA.DIST(A2,1,1e300,TRUE)'];
const expected = [1.74787125172268e-46, 1.74787125172268e-46, 2 ** -53, 3.49574250344536e-46, 0, 1];

it('preserves beta subtraction order, F-test tails and binomial precision through XLSX and copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach(([v], r) => wb.setInput(id, r, 0, String(v)));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, r, c + 3);
    if (v) expect(actual / v).toBeCloseTo(1, 11); else expect(actual).toBe(0);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 0, '0.900001');
  expect(wb.getValue(id, 0, 3)).toBe(0);
  expect(wb.getValue(id, 0, 6)).toBe(0);
  expect(wb.getValue(id, 0, 4)).toBeGreaterThan(0);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 1, c2: 8 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 5).f).toBe('BETA.DIST(A12,1,1e-16,TRUE)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains typed external HTML inputs across the native beta calculation branches', () => {
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    formulas.forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    expected.forEach((v, r) => {
      if (v) expect(wb.getValue(id, r, 2) / v).toBeCloseTo(1, 11);
      else expect(wb.getValue(id, r, 2)).toBe(0);
    });
  } finally { vi.unstubAllGlobals(); }
});
