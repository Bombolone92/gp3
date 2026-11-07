// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode, formatCodeError } from '../src/core/numfmt.js';
import { formatGeneral, formatNumberText, editText, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import native from './fixtures/reference-general-precision-clock.json';

afterEach(() => setLocale('en-US'));

it('matches native General precision, clock workspace and grammar controls', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code, { textFunction: true }), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    // Match the native reference formula without reparsing stored values as literals.
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, [{r:0,c:0,cell:{v:value}}, {r:0,c:1,cell:{v:code}}, {r:0,c:2,cell:{f:'TEXT(A1,B1)'}}]);
    expect(wb.getValue(id,0,2), `${value}: ${code}`).toEqual(expected);
    if (code === 'General') expect(formatGeneral(value), String(value)).toBe(expected);
    if (value === 'label') expect(Boolean(formatCodeError(code)), code).toBe(Boolean(expected?.error));
  }
});

it('keeps numeric editing and formula coercion separate from display precision', () => {
  expect(formatGeneral(1 / 3)).toBe('0.333333333');
  expect(formatNumberText(1 / 3)).toBe('0.333333333333333');
  expect(editText({ v: 1 / 3 })).toBe('0.333333333333333');
  expect(formatGeneral(12345678901.5)).toBe('12345678902');
  expect(formatNumberText(12345678901.5)).toBe('12345678901.5');
  setLocale('de-DE');
  expect(formatGeneral(.0000001)).toBe('0,0000001');
  expect(formatGeneral(1.234565e-8)).toBe('1,23457E-08');
  expect(formatWithCode(.5, 'Generalss.000')).toBe('0,50000000300,000');
});

it('retains raw values through edit/undo, external HTML and metadata-free XLSX', async () => {
  const cases = [
    [1 / 3, 'General', '0.333333333'],
    [12345678901.5, 'General', '12345678902'],
    [1.234565e-8, 'General', '1.23457E-08'],
    [.123456789, 'Generalh', '47.16656962'],
    [.5, 'Generalss.000', '0.50000000300.000'],
    [-.25, 'General[h]', '-0.256'],
  ];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, display]] of cases.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=A${r + 1}*2`);
    expect(wb.getDisplay(id, r, 0)).toBe(display);
    const html = cellsToHtml([[display]], [[wb.getCell(id, r, 0)]], null, [[value]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);
    expect(cell.s?.code || 'General').toBe(code);
  }
  wb.setInput(id, 0, 0, '0.25');
  expect(wb.getDisplay(id, 0, 0)).toBe('0.25');
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(1 / 3);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content)
    .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'precision.xlsx');
  for (const [r, [value, code, display]] of cases.entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0)?.code || 'General').toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(value * 2);
  }
});
