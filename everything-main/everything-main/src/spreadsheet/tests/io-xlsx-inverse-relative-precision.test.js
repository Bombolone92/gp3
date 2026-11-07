import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

const formulas = ['BETA.INV(A1,0.5,1)', 'F.INV(A1,1,1)', 'CHISQ.INV(A1,1)', 'GAMMA.INV(A1,0.5,1)'];
const expected = [1e-302, Math.PI ** 2 / 4 * 1e-302, Math.PI / 2 * 1e-302, Math.PI / 4 * 1e-302];
const relative = (actual, value) => expect(Math.abs(actual / value - 1)).toBeLessThan(1e-11);

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'tiny-quantiles.xlsx');
}

it('retains tiny quantiles through edits, Undo, shifted copies and external XLSX records', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1e-151');
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 1, '=' + f));
  const check = (r = 0) => expected.forEach((v, c) => relative(wb.getValue(id, r, c + 1), v));
  for (let pass = 0; pass < 3; pass++) {
    check();
    if (pass < 2) { wb = await external(wb); id = wb.activeSheetId; }
  }
  wb.setInput(id, 0, 0, '1e-152');
  expected.forEach((v, c) => relative(wb.getValue(id, 0, c + 1), v / 100));
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 4 }), 9, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 9, 1).f).toBe('BETA.INV(A10,0.5,1)');
  wb = await external(wb); id = wb.activeSheetId;
  check(); check(9);
});

it('copies tiny inverse results as native HTML numbers and preserves internal formulas', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1e-151');
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 1, '=' + f));
  const cells = formulas.map((_, c) => wb.getCell(id, 0, c + 1)), values = formulas.map((_, c) => wb.getValue(id, 0, c + 1));
  const html = cellsToHtml([values.map(String)], [cells], null, [values]);
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    expect(parseHtmlClipboard(html).cells[0].map(c => c.f)).toEqual(formulas);
    const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    cellsFromHtmlRows(parseHtmlClipboard(foreign).rows).forEach(({ cell }, c) => relative(cell.v, expected[c]));
  } finally { vi.unstubAllGlobals(); }
});
