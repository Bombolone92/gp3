// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, sheetToHtml } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import native from './fixtures/reference-dbnum-dates.json';

afterEach(() => { setLocale('en-US'); document.body.replaceChildren(); });

it('matches native date, clock, elapsed and scientific numeral controls', () => {
  expect(native.cases).toHaveLength(2496);
  for (const [value, code, expected] of native.cases) {
    // Native captures use TEXT(A1,B1) over stored values, not rounded formula literals.
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, [{r:0,c:0,cell:{v:value}}, {r:0,c:1,cell:{v:code}}, {r:0,c:2,cell:{f:'TEXT(A1,B1)'}}]);
    expect(wb.getValue(id,0,2), `${value}: ${code}`).toEqual(expected);
    if (typeof value === 'number') expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
  }
});

it('distinguishes full years, short calendar fields, elapsed units and literal text', () => {
  expect(formatWithCode(45000, '[DBNum1][$-804]yyyy yy d dd m mmmm')).toBe('二○二三 二十三 十五 十五 三 三月');
  expect(formatWithCode(45000.5, '[DBNum2][$-804]h:mm AM/PM "123"')).toBe('壹拾贰:零零 下午 123');
  expect(formatWithCode(45000, '[DBNum1][$-411]ggg e ee')).toBe('令和 五 〇五');
  expect(formatWithCode(1.25, '[DBNum3][$-804][h]:mm:ss')).toBe('３十:００:００');
  expect(formatWithCode(-1.25, '[DBNum1][$-804][h]')).toBe('-三十');
  expect(formatWithCode(-1.25, '[DBNum1][$-804][h]:mm')).toBe('#####');
  expect(formatWithCode(45000, '[$-2010409]yyyy-mm-dd')).toBe('٢٠٢٣-٠٣-١٥');
  // Date output must retain literal boundaries. Native short b/bb corrupts
  // preceding output for CJK numerals; the audit records that native quirk.
  expect(formatWithCode(45000, '[DBNum1][$-804]yyyy "123" b')).toBe('二○二三 123 二十三');
  expect(formatWithCode('123', '[DBNum1][$-804]yyyy;yyyy;yyyy;"year "@')).toBe('year 123');
  setLocale('zh-CN');
  expect(formatWithCode(45000, '[DBNum1]yyyy-mm-dd')).toBe('二○二三-○三-十五');
  setLocale('de-DE');
  expect(formatWithCode(0.5, '[$-2010409]hh:mm:ss.000')).toBe('١٢:٠٠:٠٠,٠٠٠');
  expect(formatWithCode(1.23456e100, '[$-2010409]General')).toBe('١,٢٣٤٦E+١٠٠');
});

const examples = [
  [45000, '[DBNum1][$-804]yyyy-mm-dd', '二○二三-○三-十五'],
  [45000, '[DBNum2][$-804]yyyy-mm-dd', '贰零贰叁-零叁-壹拾伍'],
  [45000, '[DBNum3][$-804]yyyy-mm-dd', '２０２３-０３-１５'],
  [45000, '[DBNum1][$-411]ggg e"年"m"月"d"日"', '令和 五年三月十五日'],
  [45000, '[$-2010409]yyyy-mm-dd', '٢٠٢٣-٠٣-١٥'],
  [0.5, '[$-4010409]hh:mm:ss.000', '१२:००:००.०००'],
  [1.25, '[DBNum3][$-804][h]:mm:ss', '３十:００:００'],
  [45000, '[$-27010409]yyyy-mm-dd', '이영이삼-영삼-십오'],
];

it('uses the same localized date labels in grid, print and exported HTML', async () => {
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
  for (const [r, [, code, expected]] of examples.entries()) {
    expect(wb.getDisplay(id, r, 0), code).toBe(expected);
    expect(grid.el.querySelector(`#gc-${r}-0`).textContent, code).toBe(expected);
    expect(print.querySelectorAll('td')[r].textContent, code).toBe(expected);
    expect(html.querySelectorAll('td')[r].textContent, code).toBe(expected);
  }
  grid.destroy();
});

it('retains date serials and format codes through editing, HTML copy and XLSX export', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, display]] of examples.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code });
    wb.setInput(id, r, 1, `=A${r + 1}+1`);
    const html = cellsToHtml([[display]], [[wb.getCell(id, r, 0)]], null, [[value]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value);
    expect(cell.s.code).toBe(code);
  }
  wb.setInput(id, 0, 0, '2024-02-29');
  expect(wb.getDisplay(id, 0, 0)).toBe('二○二四-○二-二十九');
  wb.undo();
  expect(wb.getDisplay(id, 0, 0)).toBe(examples[0][2]);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const reopened = await workbookFromFile(bytes, 'dates.xlsx');
  for (const [r, [value, , display]] of examples.entries()) {
    expect(reopened.getValue(reopened.activeSheetId, r, 0)).toBe(value);
    expect(reopened.getValue(reopened.activeSheetId, r, 1)).toBe(value + 1);
    expect(reopened.getDisplay(reopened.activeSheetId, r, 0)).toBe(display);
  }
});
