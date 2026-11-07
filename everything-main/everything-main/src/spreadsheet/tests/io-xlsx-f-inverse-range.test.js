import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'f-inverse.xlsx');
}

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  ['1e-154', '2', '2'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.setInput(id, 0, 5, '=F.INV.RT(A1,1,1)');
  wb.setInput(id, 1, 5, '=F.INV.RT(EXP(-709.2),A2,A3)');
  wb.setInput(id, 0, 6, '=F.INV(A1,1,1)');
  wb.setInput(id, 0, 7, '=F.INV(1e-200,1,1)');
  wb.setInput(id, 0, 8, '=FINV(1e-200,1,1)');
  return wb;
}

it('preserves extreme F quantiles and recalculation through external XLSX saves', async () => {
  let wb = setup(), id = wb.activeSheetId;
  const check = (r = 0) => {
    expect(Math.abs(wb.getValue(id, r, 5) / 4.052847345693511e307 - 1)).toBeLessThan(1e-12);
    expect(Math.abs(wb.getValue(id, r + 1, 5) / Math.exp(709.2) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(wb.getValue(id, r, 6) / 2.4674011002723395e-308 - 1)).toBeLessThan(1e-12);
    expect(wb.getValue(id, r, 7)).toBe(0);
    expect(wb.getValue(id, r, 8)).toEqual({ error: '#NUM!' });
  };
  for (let pass = 0; pass < 3; pass++) {
    check();
    if (pass < 2) { wb = await external(wb); id = wb.activeSheetId; }
  }
  wb.setInput(id, 0, 0, '1e-155');
  expect(wb.getValue(id, 0, 6)).toBe(0);
  expect(wb.getValue(id, 0, 5)).toEqual({ error: '#NUM!' });
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 8 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 5).f).toBe('F.INV.RT(A11,1,1)');
  wb = await external(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('retains a large finite quantile in formula HTML and external numeric HTML', () => {
  const wb = setup(), id = wb.activeSheetId, cell = wb.getCell(id, 0, 5), value = wb.getValue(id, 0, 5);
  const html = cellsToHtml([['4.05E+307']], [[cell]], null, [[value]]);
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    expect(parseHtmlClipboard(html).cells[0][0].f).toBe(cell.f);
    const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    expect(cellsFromHtmlRows(parseHtmlClipboard(foreign).rows)[0].cell.v).toBe(value);
  } finally { vi.unstubAllGlobals(); }
});
