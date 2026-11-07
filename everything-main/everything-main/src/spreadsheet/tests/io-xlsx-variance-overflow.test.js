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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'variance-overflow');
}

it('preserves raw-moment errors, database criteria, edits and shifted formulas through XLSX', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, c, v] of [[0, 0, 'Value'], [0, 2, 'Value'], [1, 2, '<>'], [1, 0, '0'], [2, 0, '1e154']]) wb.setInput(id, r, c, v);
  const formulas = ['VAR.S(A2:A3)', 'VAR.P(A2:A3)', 'STDEV.P(A2:A3)', 'DVARP(A1:A3,"Value",C1:C2)',
    'DEVSQ(A2:A3)', 'SUBTOTAL(11,A2:A3)', 'AGGREGATE(11,6,A2:A3)', 'VAR.S({7e153,7e153})'];
  formulas.forEach((f, c) => wb.setInput(id, 0, c + 3, '=' + f));
  const num = { error: '#NUM!' }, expected = [5e307, num, num, num, 5e307, num, num, num];
  const check = (row = 0) => expected.forEach((v, c) => {
    const actual = wb.getValue(id, row, c + 3);
    if (typeof v === 'number') expect(actual / v).toBeCloseTo(1, 13);
    else expect(actual).toEqual(v);
  });
  check();
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f, c) => expect(wb.getCell(id, 0, c + 3).f).toBe(f));
    check();
  }
  wb.setInput(id, 2, 0, '7e153');
  expect(wb.getValue(id, 0, 4) / 1e307).toBeCloseTo(1.225, 13);
  wb.undo(); check();
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 10 }), 10, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 10, 6).f).toBe('DVARP(A11:A13,"Value",C11:C12)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  check(); check(10);
});

it('counts externally pasted booleans for A-functions, including the population overflow check', () => {
  const values = [[0, 8e153, false]];
  const html = cellsToHtml(values.map(row => row.map(String)), values.map(row => row.map(v => ({ v }))), null, values)
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    wb.setInput(id, 2, 0, '=VAR.P(A1:C1)');
    wb.setInput(id, 3, 0, '=VARPA(A1:C1)');
    wb.setInput(id, 4, 0, '=VARPA(HSTACK(A1:C1))');
    expect(wb.getValue(id, 2, 0) / 1e307).toBeCloseTo(1.6, 13);
    expect(wb.getValue(id, 3, 0)).toEqual({ error: '#NUM!' });
    expect(wb.getValue(id, 4, 0) / 1e307).toBeCloseTo(1.6, 13);
  } finally { vi.unstubAllGlobals(); }
});
