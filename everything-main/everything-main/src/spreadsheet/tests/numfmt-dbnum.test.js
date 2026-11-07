// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode, formatCodeError } from '../src/core/numfmt.js';
import { setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, sheetToHtml } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import * as X from '../src/vendor/xlsx.mjs';
import native from './fixtures/reference-dbnum-numeric.json';

afterEach(() => { setLocale('en-US'); document.body.replaceChildren(); });

it('matches every native numeric DBNum and extended numeral-system control', () => {
  expect(native.cases).toHaveLength(2264);
  for (const [value, code, expected] of native.cases) {
    // Native captures use TEXT(A1,B1) over stored values, not rounded formula literals.
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, [{r:0,c:0,cell:{v:value}}, {r:0,c:1,cell:{v:code}}, {r:0,c:2,cell:{f:'TEXT(A1,B1)'}}]);
    expect(wb.getValue(id,0,2), `${value}: ${code}`).toEqual(expected);
    if (typeof value === 'number') expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
  }
});

it('keeps literals and raw text separate from numeral fields and uses the current regional default', () => {
  const code = '[DBNum2]"123 "0.00" 456"';
  expect(formatWithCode(12.5, code)).toBe('123 12.50 456');
  setLocale('zh-CN');
  expect(formatWithCode(12.5, code)).toBe('123 壹贰.伍零 456');
  setLocale('ja-JP');
  expect(formatWithCode(12.5, code)).toBe('123 壱弐.伍〇 456');
  setLocale('de-DE');
  expect(formatWithCode(12.5, '[DBNum2][$-804]0.00')).toBe('壹贰,伍零');
  expect(formatWithCode(12.5, '[DBNum2][$-804]General')).toBe('壹拾贰,伍');
  expect(formatWithCode(12.5, '[$-2010409]General')).toBe('١٢,٥');
  for (const value of ['123', '零', true, false]) {
    expect(formatWithCode(value, '[DBNum2][$-804]0;0;0;"123:"@')).toBe(`123:${String(value).replace('true', 'TRUE').replace('false', 'FALSE')}`);
  }
  for (const bad of ['[DBNum0]0', '[DBNum5]0', '[DBNum1][DBNum2]0']) expect(formatCodeError(bad)).toBeTruthy();
});

const examples = [
  [100010001, '[DBNum1][$-804]General', '一亿○一万○一'],
  [10001, '[DBNum2][$-404]General', '壹萬零壹'],
  [1010.05, '[DBNum1][$-411]General', '千十.〇五'],
  [1010.05, '[DBNum2][$-412]General', '壹阡壹拾.零伍'],
  [1234.56, '[DBNum3][$-804]#,##0.00', '１,２３４.５６'],
  [1.25, '[DBNum1][$-804]# ?/16', '一 四/一六'],
  [1234.56, '[DBNum1][$-804]0.00E+00', '一.二三E+○三'],
  [12.5, '[$-27010409]0.00', '일이.오영'],
  [12.5, '[$-2010409]0.00', '١٢.٥٠'],
];

it('shares localized numeric rendering across formula cells, grid, print and HTML', async () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: text.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
  const wb = new Workbook({ sheets: [{ colWidths: { 0: 500 } }] }), id = wb.activeSheetId;
  for (const [r, [value, code]] of examples.entries()) {
    wb.setInput(id, r, 0, `=${value}`);
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
  }
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.append(grid.el);
  await new Promise(resolve => setTimeout(resolve, 10));
  const print = buildPrintTable(wb, id, { headers: false });
  const html = new DOMParser().parseFromString(sheetToHtml(wb, id), 'text/html');
  for (const [r, [, code, display]] of examples.entries()) {
    expect(wb.getDisplay(id, r, 0), code).toBe(display);
    expect(grid.el.querySelector(`#gc-${r}-0`).textContent, code).toBe(display);
    expect(print.querySelectorAll('td')[r].textContent, code).toBe(display);
    expect(html.querySelectorAll('td')[r].textContent, code).toBe(display);
  }
  grid.destroy();
});

it('preserves numeric values and formats through edit/undo, HTML paste and native XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, display]] of examples.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=A${r + 1}*2`);
    const html = cellsToHtml([[display]], [[wb.getCell(id, r, 0)]], null, [[value]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);
    expect(cell.s.code).toBe(code);
    expect(formatWithCode(cell.v, cell.s.code)).toBe(display);
  }
  wb.setInput(id, 0, 0, '222');
  expect(wb.getDisplay(id, 0, 0)).toBe('二百二十二');
  expect(wb.getValue(id, 0, 1)).toBe(444);
  wb.undo();
  expect(wb.getDisplay(id, 0, 0)).toBe(examples[0][2]);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'numerals.xlsx');
  for (const [r, [value, code, display]] of examples.entries()) {
    expect(back.getValue(back.activeSheetId, r, 0)).toBe(value);
    expect(back.styleAt(back.activeSheetId, r, 0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId, r, 0)).toBe(display);
    expect(back.getValue(back.activeSheetId, r, 1)).toBe(value * 2);
  }
});
