import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

const values = ['1$', 'USD1', '$(1)', '(+1)', '€1 1/2', '%(50)', '$\u00a01'];
const expected = [{ error: '#VALUE!' }, { error: '#VALUE!' }, -1, { error: '#VALUE!' }, 1.5, -0.5, { error: '#VALUE!' }];

it('keeps DOLLAR regional formatting live across XLSX and locale changes', async () => {
  const previous = getLocale();
  try {
    setLocale('en-GB');
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=DOLLAR(-1234.5)');
    wb.setInput(id, 0, 1, '=VALUE(A1)');
    const blob = await workbookToXlsx(wb);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const native = X.read(bytes, { type: 'array' }).Sheets.Sheet1;
    expect(native.A1.f).toBe('DOLLAR(-1234.5)');
    expect(native.A1.v).toBe('(£1,234.50)');
    expect(native.B1.v).toBe(-1234.5);
    // The formula follows the recipient's regional format.
    setLocale('de-DE');
    const restored = await workbookFromFile(bytes, 'regional-currency.xlsx');
    expect(restored.getValue(restored.activeSheetId, 0, 0)).toBe('(1.234,50\u00a0€)');
    expect(restored.getValue(restored.activeSheetId, 0, 1)).toBe(-1234.5);
  } finally { setLocale(previous); }
});

it('keeps numeric text and live coercion through native XLSX, edits, Undo and internal copying', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, values.flatMap((v, r) => [{ r, c: 0, cell: { v } }, { r, c: 1, cell: { f: `VALUE(A${r + 1})` } }]));
  for (let pass = 0; pass < 2; pass++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const sheet = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
    expect(sheet).toContain('<f>VALUE(A1)</f>');
    expect(sheet).toContain('#VALUE!');
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'numeric-syntax.xlsx');
    id = wb.activeSheetId;
    for (const [r, value] of values.entries()) {
      expect(wb.getValue(id, r, 0)).toBe(value);
      expect(wb.getValue(id, r, 1)).toEqual(expected[r]);
    }
  }
  wb.setInput(id, 0, 0, "'$1");
  expect(wb.getValue(id, 0, 1)).toBe(1);
  wb.undo(); expect(wb.getValue(id, 0, 1)).toEqual(expected[0]);
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 6, c2: 1 }), 10, 3, { r: 0, c: 0 });
  for (const [r, value] of expected.entries()) {
    expect(wb.getCell(id, r + 10, 4).f).toBe(`VALUE(D${r + 11})`);
    expect(wb.getValue(id, r + 10, 4)).toEqual(value);
  }
});

it('preserves currency strings through external HTML before formula conversion', () => {
  const cells = values.map(v => [{ v }]);
  const html = cellsToHtml(values.map(v => [v]), cells, null, values.map(v => [v])).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  try {
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows);
    expect(pasted.map(x => x.cell.v)).toEqual(values);
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, pasted.map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    for (const [r, value] of expected.entries()) {
      wb.setInput(id, r, 1, `=VALUE(A${r + 1})`);
      expect(wb.getValue(id, r, 1)).toEqual(value);
    }
  } finally { vi.unstubAllGlobals(); }
});
