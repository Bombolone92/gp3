// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'inverse-underflow.xlsx');
}

it('recalculates inverse t errors across edits, Undo, shifted copies and external XLSX saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '-710');
  wb.setInput(id, 0, 1, '=EXP(A1)');
  wb.setInput(id, 0, 2, '=T.INV(B1,2)');
  wb.setInput(id, 0, 3, '=T.INV(B1,1000)');
  const check = (r = 0) => {
    expect(wb.getValue(id, r, 1)).toBe(Math.exp(-710));
    for (const c of [2, 3]) expect(wb.getValue(id, r, c)).toEqual({ error: '#NUM!' });
  };
  for (let pass = 0; pass < 3; pass++) {
    check();
    if (pass < 2) { wb = await external(wb); id = wb.activeSheetId; }
  }
  wb.setInput(id, 0, 0, '-709');
  expect(wb.getValue(id, 0, 2)).toBeLessThan(-6e153);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 3 }), 9, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 9, 2).f).toBe('T.INV(B10,2)');
  wb = await external(wb); id = wb.activeSheetId;
  check(); check(9);
});

it('preserves inverse errors as formulas internally and typed errors in external HTML', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=T.INV(EXP(-710),3)');
  const cell = wb.getCell(id, 0, 0), value = wb.getValue(id, 0, 0);
  const html = cellsToHtml([['#NUM!']], [[cell]], null, [[value]]);
  expect(parseHtmlClipboard(html).cells[0][0].f).toBe(cell.f);
  const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(foreign).rows)[0].cell.v).toEqual({ error: '#NUM!' });
});
