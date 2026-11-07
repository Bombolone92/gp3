// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode, formatCodeError, codeIsFraction } from '../src/core/numfmt.js';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

// Recalculated in desktop Excel: literals between numerator, slash and
// denominator are part of the fraction, including its blanked zero width.
const native = [
  ['?/ ?', '11/ 4', '0/ 1'], ['? /?', '11 /4', '0 /1'],
  ['? / ?', '11 / 4', '0 / 1'], ['# ? / ?', '2 3 / 4', '0      '],
  ['?? / 16', '44 / 16', ' 0 / 16'], ['?/"of"?', '11/of4', '0/of1'],
  ['?/\\,?', '11/,4', '0/,1'], ['?/","?', '11/,4', '0/,1'],
  ['?/,?', '11/,4', '0/,1'], ['?/ x?', '11/ x4', '0/ x1'],
  ['?/"prefix"16', '44/prefix16', '0/prefix16'], ['?/ 16', '44/ 16', '0/ 16'],
  ['?/1" "6', '17/1 6', '0/1 6'], ['?/"x"??', '11/x4 ', '0/x1 '],
  ['?/??"x"', '11/4 x', '0/1 x'], ['?"x"/?', '11x/4', '0x/1'],
  ['? "x"/?', '11 x/4', '0 x/1'], ['?/?","', '11/4,', '0/1,'],
  ['?/ ?%', '275/ 1%', '0/ 1%'], ['0 / 0', '11 / 4', '0 / 1'],
  ['# ? / 8', '2 6 / 8', '0      '],
  ['# ?"n"/"d"?', '2 3n/d4', '0      '],
  ['# ?"n"/"d"16', '2 12n/d16', '0       '],
];

it.each(native)('preserves the fraction syntax and zero width of %s', (code, positive, zero) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(2.75, code)).toBe(positive);
  expect(formatWithCode(-2.75, code)).toBe('-' + positive);
  expect(formatWithCode(0, code)).toBe(zero);
  expect(formatWithCode(-2.75, `${code};(${code})`)).toBe(`(${positive})`);
});

it('distinguishes comma placement and retains whole-part grouping without decimal scaling', () => {
  for (const code of ['?/?,', '?/?,,', '?/?,"x"', '# ?/?,', '?/?,%']) {
    for (const value of [.5, -2.75, 1234.5]) expect(formatWithCode(value, code, { overflow: null })).toBeNull();
  }
  expect(formatWithCode(0, '?/?,')).toBe('0/1');
  expect(formatWithCode(0, '?/?,"x"')).toBe('0/1x');
  for (const code of ['?/?,?', '?/??,??', '?/?,0', '?/?,#']) {
    expect(formatWithCode(0, code, { overflow: null })).toBeNull();
    expect(formatWithCode(2.75, code, { overflow: null })).toBeNull();
  }
  expect(formatWithCode(1234.5, '#, ?/?')).toBe('1234 1/2');
  expect(formatWithCode(1234.5, '#,, ?/?')).toBe('1234 1/2');
  expect(formatWithCode(1234.5, '#,##0, ?/?')).toBe('1,234 1/2');
  expect(formatWithCode(1234.5, '?,/?')).toBe('2469/2');
  expect(formatWithCode(1234.5, '?/,?')).toBe('2469/,2');
  expect(formatWithCode(1234.5, '0.0,')).toBe('1.2');
  expect(formatWithCode(2.75, '0.00" / units"')).toBe('2.75 / units');
});

it('rejects missing, repeated and mixed denominator syntax consistently', () => {
  for (const code of ['?/', '0/"kg"', '?/?/', '?/?/?', '?/1?', '?/1#', '?/10?']) {
    expect(formatCodeError(code)).toBeTruthy();
    expect(formatWithCode(0, code, { overflow: null })).toBeNull();
    expect(formatWithCode(2.75, code)).toBe('#####');
  }
});

it('reads spaced fractions from native display-only HTML and uses the selected format section', () => {
  for (const [code, text] of native.slice(0, 5)) {
    const html = cellsToHtml([[text]], [[{ v: 2.75, f: null, s: { fmt: 'custom', code } }]], null, [[2.75]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '').replace(/ x:num="[^"]*"/g, '');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(2.75); expect(cell.s.code).toBe(code);
  }
  for (const text of ['11 / 4', '11/ 4', '11 /4', '2 3 / 4', '2\u00a03 /\u00a04']) {
    expect(cellFromInput(text, { fmt: 'custom', code: '# ? / ?' }).v).toBe(2.75);
  }
  expect(cellFromInput('-1 / 2', { fmt: 'custom', code: '0.00;# ? / ?' }).v).toBe(-.5);
  expect(codeIsFraction(1, '0.00;# ? / ?')).toBe(false);
  expect(codeIsFraction(-1, '0.00;# ? / ?')).toBe(true);
  expect(codeIsFraction(1, '0" / "0')).toBe(false);
  expect(codeIsFraction(1, 'm/d/yyyy')).toBe(false);
  expect(cellFromInput("'11 / 4", { fmt: 'custom', code: '? / ?' }).v).toBe('11 / 4');
  expect(cellFromInput('11 / 4', { fmt: 'text' }).v).toBe('11 / 4');
});

it('keeps raw values, format codes and TEXT results through edits, clipboard and native XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  native.forEach(([code, text], r) => {
    wb.setInput(id, r, 0, '2.75');
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code.replaceAll('"', '""')}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(text); expect(wb.getValue(id, r, 1)).toBe(text);
    const cell = { v: 2.75, f: null, s: { fmt: 'custom', code } };
    const html = cellsToHtml([[text]], [[cell]], null, [[2.75]]);
    expect(parseHtmlClipboard(html).cells).toEqual([[cell]]);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(2.75); expect(pasted.s.code).toBe(code);
  });
  const errorRow = native.length;
  wb.setInput(id, errorRow, 0, '=TEXT(2.75,"?/?,")');
  expect(wb.getValue(id, errorRow, 0)).toEqual({ error: '#VALUE!' });
  wb.setInput(id, 0, 0, '0'); expect(wb.getValue(id, 0, 1)).toBe(native[0][2]); wb.undo();
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  native.forEach(([code, text], r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(2.75);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(text);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(text);
  });
  expect(restored.getValue(restored.activeSheetId, errorRow, 0)).toEqual({ error: '#VALUE!' });
});
