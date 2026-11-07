// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { codeDateKind, formatCodeError, formatWithCode } from '../src/core/numfmt.js';
import { CALENDAR_END, getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc, calcValues } from './helpers/calc.js';

const locale = getLocale();
afterEach(() => setLocale(locale));
// Calculated and saved in desktop Excel. The decimal field is
// always a fraction of a SECOND, even after hours or a calendar date.
const serial = 45000 + 12345.6789 / 86400;
const native = [
  ['[h].000', '1080003.679'], ['[m].000', '64800205.679'], ['[s].000', '3888012345.679'],
  ['[h].0', '1080003.7'], ['h.000', '3.679'], ['m.000', '25.679'],
  ['mm.000', '25.679'], ['mmm.000', 'Mar.679'], ['d.000', '15.679'], ['yyyy.000', '2023.679'],
  ['AM/PM.000', 'AM.679'], ['h "x".000', '3 x.679'], ['[h] "x".000', '1080003 x.679'],
  ['h.000.0', '3.679.6'], ['h.0.000', '3.6.679'], ['h.00.000', '3.67.679'],
  ['h.000:ss', '3.679:45'], ['m.000 m', '25.679 3'], ['m m.000', '3 25.679'],
  ['d.000 m', '15.679 25'], ['ss.000 m', '45.679 25'], ['mmm.000 m', 'Mar.679 25'],
  ['m.000 m.000', '25.679 25.679'], ['h.000 d m', '3.679 15 25'],
];
it.each(native)('formats fractional fields in %s', (code, display) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(serial, code)).toBe(display);
  expect(calcValues('TEXT(A1,B1)', {A1:serial,B1:code})).toBe(display);
});

it.each(['ss.0000', '[h].0000', 'h.00#', '[m].00?', '[h] 000', '0.000 h', '.000 m'])('rejects invalid date/number syntax in every section of %s', code => {
  expect(formatCodeError(code)).toBeTruthy();
  for (const value of [1.5, -1.5, 0, 'label', true]) {
    expect(formatWithCode(value, `0;${code}`)).toBe('#####');
    expect(formatWithCode(value, code, { overflow: 'invalid' })).toBe('invalid');
  }
  expect(calc(`TEXT(TRUE,"0;${code}")`)).toEqual({ error: '#VALUE!' });
});

it('retains decimal numbers and quoted or escaped fractional literals', () => {
  expect(formatWithCode(serial, '.000')).toBe('45000.143');
  expect(formatWithCode(serial, '[h]".000"')).toBe('1080003.000');
  expect(formatWithCode(serial, '[h]\\.\\0\\0\\0')).toBe('1080003.000');
  expect(formatCodeError('0.0000')).toBeNull();
  expect(codeDateKind(serial, 'm.000')).toBe('time');
  expect(codeDateKind(serial, 'mmm.000')).toBe('datetime');
  expect(codeDateKind(serial, 'yyyy.000')).toBe('datetime');
});

it.each(['[h].000', '[m].000', '[s].000', 'h.000', 'm.000', 'd.000'])('carries fractional rounding and enforces the calendar bound in %s', code => {
  for (const value of [CALENDAR_END, CALENDAR_END + 0.5, 1e22, CALENDAR_END - 1 + 86399.9996 / 86400]) {
    expect(formatWithCode(value, code)).toBe('#####');
    expect(calcValues('TEXT(A1,B1)', {A1:value,B1:code})).toEqual({ error: '#VALUE!' });
  }
  expect(formatWithCode(2 + 3599.9996 / 86400, '[h].000')).toBe('49.000');
  expect(formatWithCode(CALENDAR_END - 0.5, '[h].000')).toBe('71003172.000');
  expect(formatWithCode(CALENDAR_END, '[h]".000"')).toBe('71003184.000');
});

it('uses the regional decimal mark for all fractional-second fields', () => {
  setLocale('de-DE');
  expect(formatWithCode(serial, '[h] "hours".000')).toBe('1080003 hours,679');
  expect(formatWithCode(serial, 'm.000')).toBe('25,679');
});

it('preserves numeric values, fractional formats and formulas through edits, clipboard and XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [code, display]] of native.slice(0, 3).entries()) {
    wb.setInput(id, r, 0, String(serial));
    wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(display);
    const html = cellsToHtml([[display]], [[wb.getCell(id, r, 0)]], null, [[serial]]);
    expect(parseHtmlClipboard(html).cells[0][0].v).toBe(serial);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(serial); expect(pasted.s.code).toBe(code);
  }
  wb.setInput(id, 0, 0, String(1.5 + 12.3456 / 86400));
  expect(wb.getValue(id, 0, 1)).toBe('36.346'); wb.undo();
  expect(wb.getValue(id, 0, 1)).toBe(native[0][1]);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'fractional.xlsx');
  for (const [r, [code, display]] of native.slice(0, 3).entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(serial);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(display);
  }
});
