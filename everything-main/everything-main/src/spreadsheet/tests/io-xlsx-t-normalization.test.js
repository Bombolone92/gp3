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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 't-normalization');
}

const values = [[1e-7], [1e-5]];
const formulas = ['T.DIST.RT(A1,1000)', 'T.DIST.2T(A1,2)', 'T.DIST.2T(A1,3)',
  'T.TEST(SEQUENCE(10),SEQUENCE(10)+A1,2,2)', 'TTEST(SEQUENCE(1000),SEQUENCE(1000)+A2,2,2)'];
const expected = [0.5, 1 - 714.634585952112 / 1e10, 1 - 735.105194493713 / 1e10,
  1 - 703.5300431113 / 1e10, 1 - 6508.02487900393 / 1e10];

it('preserves t normalization, recalculation and shifted copies through native XLSX records', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach(([v], r) => wb.setInput(id, r, 0, String(v)));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => {
    expect(wb.getValue(id, r, 3)).toBe(0.5);
    expected.slice(1).forEach((v, c) => expect(wb.getValue(id, r, c + 4)).toBeCloseTo(v, 15));
  };
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 0, '0.001');
  expect(wb.getValue(id, 0, 3)).toBeLessThan(0.5);
  expect(wb.getValue(id, 0, 6)).toBeLessThan(expected[3]);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 1, c2: 7 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 6).f).toBe('T.TEST(SEQUENCE(10),SEQUENCE(10)+A11,2,2)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains small numeric inputs from external HTML at native normalization boundaries', () => {
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    formulas.forEach((f, r) => wb.setInput(id, r, 2, '=' + f));
    expect(wb.getValue(id, 0, 2)).toBe(0.5);
    expected.slice(1).forEach((v, r) => expect(wb.getValue(id, r + 1, 2)).toBeCloseTo(v, 15));
  } finally { vi.unstubAllGlobals(); }
});
