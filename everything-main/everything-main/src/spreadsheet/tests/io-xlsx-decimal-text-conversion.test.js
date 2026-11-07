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
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'decimal-text.xlsx');
}

it('keeps text, conversion errors and formulas live through native XLSX, edits and Undo', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const values = ['1e309%', '1e308', '1.234567890123459', '0'.repeat(255) + '1'];
  wb.setCells(id, values.flatMap((v, r) => [{ r, c: 0, cell: { v } }, { r, c: 1, cell: { f: `VALUE(A${r + 1})` } }, { r, c: 2, cell: { f: `NUMBERVALUE(A${r + 1})` } }]));
  const expected = [[1e307, { error: '#VALUE!' }], [{ error: '#VALUE!' }, { error: '#VALUE!' }], [1.23456789012345, 1.23456789012345], [{ error: '#VALUE!' }, { error: '#VALUE!' }]];
  for (let pass = 0; pass < 2; pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    for (let r = 0; r < values.length; r++) {
      expect(wb.getValue(id, r, 0)).toBe(values[r]);
      expect([wb.getValue(id, r, 1), wb.getValue(id, r, 2)]).toEqual(expected[r]);
      expect(wb.getCell(id, r, 1).f).toBe(`VALUE(A${r + 1})`);
    }
  }
  wb.setInput(id, 0, 0, "'1e307%");
  expect(wb.getValue(id, 0, 2)).toBe(1e305);
  wb.undo(); expect(wb.getValue(id, 0, 2)).toEqual({ error: '#VALUE!' });
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 2 }), 9, 0, { r: 0, c: 0 });
  expect(wb.getCell(id, 9, 1).f).toBe('VALUE(A10)');
  expect(wb.getValue(id, 9, 1)).toBe(1e307);
  expect(wb.getValue(id, 9, 2)).toEqual({ error: '#VALUE!' });
});

it('preserves numeric text and conversion errors through external HTML', () => {
  const values = [['1e309%'], ['1.234567890123459'], [{ error: '#VALUE!' }]];
  const cells = values.map(row => row.map(v => ({ v })));
  const html = cellsToHtml(values.map(row => row.map(v => v?.error || String(v))), cells, null, values).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows);
    expect(pasted.map(x => x.cell.v)).toEqual(values.flat());
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, pasted.map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    wb.setInput(id, 0, 1, '=VALUE(A1)');
    wb.setInput(id, 1, 1, '=VALUE(A2)');
    expect(wb.getValue(id, 0, 1)).toBe(1e307);
    expect(wb.getValue(id, 1, 1)).toBe(1.23456789012345);
  } finally { vi.unstubAllGlobals(); }
});
