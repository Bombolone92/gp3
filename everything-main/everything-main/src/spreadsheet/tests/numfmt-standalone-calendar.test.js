// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { codeDateKind, formatCodeError, formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';

// TEXT controls measured in desktop Excel, including zero and its fictitious leap day.
const serial = 45000 + 12345.6789 / 86400;
const cases = [
  [0, 'g', ''], [60, 'gg', ''], [serial, 'gggg', ''],
  [serial, 'g.000', '.679'], [0, 'b', '43'], [60, 'b', '43'],
  [serial, 'b', '66'], [serial, 'bb', '66'], [serial, 'bbb', '2566'],
  [serial, 'bbbbb', '2566'], [serial, 'b.000', '66.679'], [serial, 'B.0', '66.7'],
  [serial, 'gb', '66'], [serial, 'kg', 'k'], [serial, 'lb', 'l66'],
  [0, '[$-411]g', 'M'], [60, '[$-411]gg', '明'], [serial, '[$-411]ggg', '令和'],
  [serial, '[$-409]g', ''], [serial, 'b1g', ''], [serial, 'b1b', '66'],
];
it.each(cases)('recognizes standalone calendar fields in %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(calc(`TEXT(${value},"${code}")`)).toBe(expected);
  expect(codeDateKind(value, code)).toBe(code.includes('.0') ? 'datetime' : 'date');
});

it.each(['g', 'gggg', 'b', 'B.0', 'g.000', 'gb', 'kg', 'lb', '[$-411]g'])('enforces calendar bounds for %s', code => {
  for (const value of [-1, 2958466]) {
    expect(formatWithCode(value, code)).toBe('#####');
    expect(calc(`TEXT(${value},"${code}")`)).toEqual({ error:'#VALUE!' });
  }
  expect(calc(`TEXT("label","${code}")`)).toBe('label');
  expect(calc(`TEXT(TRUE,"${code}")`)).toBe('TRUE');
});

it.each(['0 kg', '0 lb', '0 g', '0 b'])('rejects unquoted date letters in numeric format %s', code => {
  expect(formatCodeError(code)).toBeTruthy();
  for (const value of ['5', '"label"', 'TRUE']) expect(calc(`TEXT(${value},"${code}")`)).toEqual({ error:'#VALUE!' });
});

it('keeps quoted/escaped labels, General and calendar selectors separate', () => {
  expect(formatWithCode(5, '0 "kg"')).toBe('5 kg');
  expect(formatWithCode(5, '0 l\\b')).toBe('5 lb');
  expect(formatWithCode(5, 'General')).toBe('5');
  for (const code of ['"g"', '\\b']) expect(codeDateKind(5, code)).toBeNull();
  for (const code of ['b1', 'b2']) {
    expect(formatWithCode(5, code)).toBe('');
    expect(formatWithCode(-1, code)).toBe('-');
    expect(codeDateKind(5, code)).toBeNull();
  }
});

it('preserves calendar semantics through edits, HTML and metadata-free XLSX', async () => {
  const examples = cases.filter(([, code]) => ['b', 'g.000', 'b.000', '[$-411]ggg'].includes(code));
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, expected]] of examples.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(expected);
    expect(wb.getValue(id, r, 1)).toBe(expected);
    const html = cellsToHtml([[expected]], [[wb.getCell(id, r, 0)]], null, [[value]]);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(value); expect(pasted.s.code).toBe(code);
  }
  wb.setInput(id, 0, 0, '0'); expect(wb.getValue(id, 0, 1)).toBe('.000');
  wb.undo(); expect(wb.getValue(id, 0, 1)).toBe('.679');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'calendar.xlsx');
  for (const [r, [value, code, expected]] of examples.entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(expected);
  }
});
