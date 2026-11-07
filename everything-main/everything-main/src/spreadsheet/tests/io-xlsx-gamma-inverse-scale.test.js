import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

const formulas = ['GAMMA.INV(A1,0.5,1e100)', 'CHISQ.INV(A1,1)', 'GAMMA.INV(A2,1,1e100)', 'CHISQ.INV.RT(A2,2)', 'GAMMA.INV(1e-300,100,1e307)'];
const expected = [0, 0, -Math.log1p(-(1 - 1e-10)) * 1e100, -2 * Math.log(1 - 1e-10), 3.8006988916942e305];
const checkValue = (actual, value) => value === 0 ? expect(actual).toBe(0) : expect(Math.abs(actual / value - 1)).toBeLessThan(1e-10);

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'gamma-scale.xlsx');
}

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1e-154'); wb.setInput(id, 1, 0, '=1-1e-10');
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 1, '=' + f));
  return wb;
}

it('preserves scaled gamma quantiles, edits and shifted references through external XLSX saves', async () => {
  let wb = setup(), id = wb.activeSheetId;
  const check = (r = 0) => expected.forEach((v, c) => checkValue(wb.getValue(id, r, c + 1), v));
  for (let pass = 0; pass < 3; pass++) {
    check();
    if (pass < 2) { wb = await external(wb); id = wb.activeSheetId; }
  }
  wb.setInput(id, 0, 0, '2e-154');
  checkValue(wb.getValue(id, 0, 1), Math.PI * 1e-208);
  checkValue(wb.getValue(id, 0, 2), 2 * Math.PI * 1e-308);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 1, c2: 5 }), 9, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 9, 3).f).toBe('GAMMA.INV(A11,1,1e100)');
  wb = await external(wb); id = wb.activeSheetId;
  check(); check(9);
});

it('copies gamma quantiles as formulas internally and numeric values in external HTML', () => {
  const wb = setup(), id = wb.activeSheetId;
  const cells = formulas.map((_, c) => wb.getCell(id, 0, c + 1)), values = formulas.map((_, c) => wb.getValue(id, 0, c + 1));
  const html = cellsToHtml([values.map(String)], [cells], null, [values]);
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    expect(parseHtmlClipboard(html).cells[0].map(c => c.f)).toEqual(formulas);
    const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    cellsFromHtmlRows(parseHtmlClipboard(foreign).rows).forEach(({ cell }, c) => checkValue(cell.v, expected[c]));
  } finally { vi.unstubAllGlobals(); }
});
