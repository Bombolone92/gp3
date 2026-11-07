// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { editText, setLocale, styleToNumFmt } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => setLocale('en-US'));

// TEXT results measured in desktop Excel, including carries across exponent
// groups, optional/mandatory/alignment slots, zero, labels, grouping and percent.
const values = [0, 2.75, -2.75, 0.125, 1234.5, 999.94, 999.95, 9999.5, 0.00099995, 1e-12, 100000000000000000000];
const native = [
  ["00E+00", ["00E+00", "03E+00", "-03E+00", "13E-02", "12E+02", "10E+02", "10E+02", "01E+04", "10E-04", "01E-12", "01E+20"]],
  ["000E+00", ["000E+00", "003E+00", "-003E+00", "125E-03", "001E+03", "001E+03", "001E+03", "010E+03", "001E-03", "001E-12", "100E+18"]],
  ["000.0E+00", ["000.0E+00", "002.8E+00", "-002.8E+00", "125.0E-03", "001.2E+03", "999.9E+00", "001.0E+03", "010.0E+03", "001.0E-03", "001.0E-12", "100.0E+18"]],
  ["##0.0E+00", ["000.0E+00", "2.8E+00", "-2.8E+00", "125.0E-03", "1.2E+03", "999.9E+00", "1.0E+03", "10.0E+03", "1.0E-03", "1.0E-12", "100.0E+18"]],
  ["###.0E+00", ["000.0E+00", "2.8E+00", "-2.8E+00", "125.0E-03", "1.2E+03", "999.9E+00", "1.0E+03", "10.0E+03", "1.0E-03", "1.0E-12", "100.0E+18"]],
  ["???E+00", ["000E+00", "  3E+00", "-  3E+00", "125E-03", "  1E+03", "  1E+03", "  1E+03", " 10E+03", "  1E-03", "  1E-12", "100E+18"]],
  ["??0.0E+00", ["000.0E+00", "  2.8E+00", "-  2.8E+00", "125.0E-03", "  1.2E+03", "999.9E+00", "  1.0E+03", " 10.0E+03", "  1.0E-03", "  1.0E-12", "100.0E+18"]],
  ["#0E+00", ["00E+00", "3E+00", "-3E+00", "13E-02", "12E+02", "10E+02", "10E+02", "1E+04", "10E-04", "1E-12", "1E+20"]],
  ["0#E+00", ["00E+00", "03E+00", "-03E+00", "13E-02", "12E+02", "10E+02", "10E+02", "01E+04", "10E-04", "01E-12", "01E+20"]],
  ["0?E+00", ["00E+00", "03E+00", "-03E+00", "13E-02", "12E+02", "10E+02", "10E+02", "01E+04", "10E-04", "01E-12", "01E+20"]],
  ["0,000E+00", ["0,000E+00", "0,003E+00", "-0,003E+00", "1,250E-04", "1,235E+00", "1,000E+00", "1,000E+00", "0,001E+04", "0,010E-04", "0,001E-12", "0,001E+20"]],
  ["0,000.0E+00", ["0,000.0E+00", "0,002.8E+00", "-0,002.8E+00", "1,250.0E-04", "1,234.5E+00", "0,999.9E+00", "1,000.0E+00", "9,999.5E+00", "0,010.0E-04", "0,001.0E-12", "0,001.0E+20"]],
  ["00\"x\"0.0E+00", ["00x0.0E+00", "00x2.8E+00", "-00x2.8E+00", "12x5.0E-03", "00x1.2E+03", "99x9.9E+00", "00x1.0E+03", "01x0.0E+03", "00x1.0E-03", "00x1.0E-12", "10x0.0E+18"]],
  ["000E-0", ["000E0", "003E0", "-003E0", "125E-3", "001E3", "001E3", "001E3", "010E3", "001E-3", "001E-12", "100E18"]],
  ["000.0E+00%%", ["000.0E+00%%", "002.8E+00%%", "-002.8E+00%%", "125.0E-03%%", "001.2E+03%%", "999.9E+00%%", "001.0E+03%%", "010.0E+03%%", "001.0E-03%%", "001.0E-12%%", "100.0E+18%%"]],
  ["0.00E+00", ["0.00E+00", "2.75E+00", "-2.75E+00", "1.25E-01", "1.23E+03", "1.00E+03", "1.00E+03", "1.00E+04", "1.00E-03", "1.00E-12", "1.00E+20"]],
 ];
const cases = native.flatMap(([code, displays]) => values.map((value, i) => [value, code, displays[i]]));
it.each(cases)('formats %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('uses regional marks without changing exponent steps or placeholder padding', () => {
  setLocale('de-DE');
  expect(formatWithCode(2.75, '0,000.0E+00')).toBe('0.002,8E+00');
  expect(formatWithCode(0, '??0.0E+00')).toBe('000,0E+00');
  expect(formatWithCode(-999.95, '000.0E+00;[Red](000.0E+00)')).toBe('(001,0E+03)');
});

it('preserves scientific mantissas through edits, TEXT, clipboard and metadata-free XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const selected = cases.filter(([value]) => value === 0 || value === 2.75);
  selected.forEach(([value, code, expected], r) => {
    wb.setInput(id, r, 0, value, { literal: true });
    wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code.replaceAll('"', '""')}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(expected);
    expect(wb.getValue(id, r, 1)).toBe(expected);
    expect(editText(wb.getCell(id, r, 0))).toBe(String(value));
    const html = cellsToHtml([[expected]], [[wb.getCell(id, r, 0)]], null, [[value]]);
    expect(parseHtmlClipboard(html).cells[0][0].s.code).toBe(code);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(value); expect(styleToNumFmt(pasted.s)).toBe(code);
  });
  wb.setInput(id, 1, 0, '9999.5');
  expect(wb.getValue(id, 1, 0)).toBe(9999.5);
  expect(wb.getDisplay(id, 1, 0)).toBe('01E+04');
  expect(wb.getValue(id, 1, 1)).toBe('01E+04');
  wb.undo(); expect(wb.getDisplay(id, 1, 0)).toBe('03E+00');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'native.xlsx');
  selected.forEach(([value, code, expected], r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(styleToNumFmt(restored.styleAt(restored.activeSheetId, r, 0))).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(expected);
  });
});
