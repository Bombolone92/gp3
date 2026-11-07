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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'final-cancellation');
}

const values = [[0.1, 0.2, 0.3]];
const formulas = ['A1+B1-C1', '(A1+B1-C1)', 'LET(v,A1+B1-C1,v)',
  'LAMBDA(v,v+B1-C1)(A1)', 'LAMBDA(v,(v+B1-C1))(A1)', 'SUM(A1+B1)-C1'];
const expected = [0, 2 ** -54, 2 ** -54, 0, 2 ** -54, 0];

function checkValue(actual, expected) { expect(actual).toBe(expected); }

it('preserves bare and grouped final operations, edits and shifted copies through native XLSX records', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  values.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const check = (r = 0) => expected.forEach((v, c) => checkValue(wb.getValue(id, r, c + 3), v));
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 0, 2, '0.4');
  expect(wb.getValue(id, 0, 3)).toBeCloseTo(-0.1, 15);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 8 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 4).f).toBe('(A11+B11-C11)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('preserves operand values from external HTML while applying correction only to the final operation', () => {
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    formulas.forEach((f, r) => wb.setInput(id, r, 3, '=' + f));
    expected.forEach((v, r) => checkValue(wb.getValue(id, r, 3), v));
  } finally { vi.unstubAllGlobals(); }
});

it('preserves independent custom-validation formula boundaries through XLSX', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const sources = ['0.1+0.2-0.3', '(0.1+0.2-0.3)', '0', '1'];
  const allowed = [false, true, false, true];
  sources.forEach((source, r) => {
    wb.setInput(id, r, 0, '1');
    wb.addValidation(id, { type: 'formula', source, strict: true, range: { r1: r, c1: 0, r2: r, c2: 0 } });
  });
  for (let pass = 0; pass < 2; pass++) {
    allowed.forEach((ok, r) => {
      expect(wb.validateCell(id, r, 0).ok).toBe(ok);
      expect(wb.validateInput(id, r, 0, '2').ok).toBe(ok);
    });
    wb = await nativeOnly(wb); id = wb.activeSheetId;
  }
});
