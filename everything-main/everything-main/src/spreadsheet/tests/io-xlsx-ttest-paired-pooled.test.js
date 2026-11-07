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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'ttest-paired-pooled');
}

it('preserves paired/pooled tests through native-only XLSX saves, edits, Undo and shifted copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  [[0, 4e-154], [4e-154, 0], [0, 4e-154]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const formulas = ['T.TEST(A1:A3,B1:B3,2,1)', 'T.TEST(A1:A3,B1:B3,2,2)', 'TTEST(A1:A3,B1:B3,1,1)',
    'TTEST(A1:A3,B1:B3,1,2)', 'T.TEST({1,2,3},({1,2,3}+1e-8*{1,2,1}),2,1)'];
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const expected = [0.602640292880487, 0.435330942514376, 0.301320146440244, 0.217665471257188, { error: '#DIV/0!' }];
  const check = (row = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, row, c + 3);
    if (typeof v === 'number') expect(actual / v).toBeCloseTo(1, 12);
    else expect(actual).toEqual(v);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 1, 0, '3e-154');
  expect(wb.getValue(id, 0, 4)).toEqual({ error: '#DIV/0!' });
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 7 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 3).f).toBe('T.TEST(A11:A13,B11:B13,2,1)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains statistical input types through external HTML and filters pairs by position', () => {
  const values = [[1, 2], [true, 5], [3, false], [7, 8]];
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    wb.setInput(id, 0, 3, '=T.TEST(A1:A4,B1:B4,2,1)');
    wb.setInput(id, 1, 3, '=TTEST(A1:A4,B1:B4,2,2)');
    // Only (1,2) and (7,8) remain paired: identical differences have no spread.
    expect(wb.getValue(id, 0, 3)).toEqual({ error: '#DIV/0!' });
    expect(wb.getValue(id, 1, 3)).toBeGreaterThan(0);
    expect(wb.getValue(id, 1, 3)).toBeLessThan(1);
  } finally { vi.unstubAllGlobals(); }
});
