// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsFromHtmlRows, parseHtmlClipboard, cellsToHtml } from '../src/core/clipboard.js';
import { formatCodeError, formatWithCode } from '../src/core/numfmt.js';
import { styleToNumFmt } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// mso-number-format spellings as Excel writes them. The input data below has no
// private application metadata and exercises the same CSS decoding as Excel HTML.
function read(code, text, value) {
  const css = code.replaceAll('\\','\\\\').replaceAll('[','\\[').replaceAll(']','\\]').replaceAll('"','\\0022');
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><style>.date {mso-number-format:"${css}"}</style><table><tr><td class="date"${value == null ? '' : ` x:num="${value}"`}>${text}</td></tr></table></html>`;
  return cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
}

it.each([
  ['[HIJ]yyyy-mm-dd', 'B2yyyy-mm-dd', '1444-08-23'],
  ['[$-60401]yyyy-mm-dd', '[$-60401]yyyy-mm-dd', '1444-08-23'],
  ['[THA][$-7041E]yyyy-mm-dd', '[$-7041E]yyyy-mm-dd', '2566-03-15'],
  ['[THA]yyyy-mm-dd', 'yyyy-mm-dd', '2023-03-15'],
  ['[JPN][$-411]y', '[$-411]e', '5'],
  ['[JPN][$-411]yy', '[$-411]ee', '05'],
  ['[JPN][$-411]ggg y"年"m"月"d"日"', '[$-411]ggg e"年"m"月"d"日"', '令和 5年3月15日'],
  ['[JPN][$-411]yyyy ggg y', '[$-411]yyyy ggg e', '2023 令和 5'],
  ['[JPN][$-411]ggg yy;[JPN]ggg y', '[$-411]ggg ee;ggg e', '令和 05'],
  ['[JPN][DBNum1][$-411]ggg y', '[DBNum1][$-411]ggg e', '令和 五'],
  ['[JPN]ggg y', '[$-411]ggg e', '令和 5'],
  ['[TWN][$-40409]yyyy mmmm ddd', '[$-40409]yyyy mmmm ddd', '2023 三月 週三'],
  ['[ENG][<0][$-40409]mmmm;[ENG]mmmm', '[<0][$-40409]mmmm;mmmm', '三月'],
  ['[TWN]yyyy mmmm ddd', 'yyyy mmmm ddd', '2023 March Wed'],
  ['[ENG]yyyy mmmm ddd', 'yyyy mmmm ddd', '2023 March Wed'],
  ['[TWN][$-20409]yyyy mmmm ddd', '[$-20409]yyyy mmmm ddd', '2023 March Wed'],
  ['[ENG][$-70409]yyyy mmmm ddd', '[$-70409]yyyy mmmm ddd', '2566 มีนาคม พ.'],
])('translates Excel HTML calendar marker %s', (htmlCode, code, display) => {
  const cell = read(htmlCode, display, 45000);
  expect(cell.v).toBe(45000); expect(styleToNumFmt(cell.s)).toBe(code);
  expect(formatWithCode(cell.v, styleToNumFmt(cell.s))).toBe(display);
  const exported = cellsToHtml([[display]], [[cell]], null, [[cell.v]]);
  const again = cellsFromHtmlRows(parseHtmlClipboard(exported.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'')).rows)[0].cell;
  expect(again.v).toBe(45000); expect(styleToNumFmt(again.s)).toBe(code);
});

it('matches Excel when its HTML contains displayed dates but omits numeric serials', () => {
  const hijri = read('[HIJ]yyyy-mm-dd','1444-08-23');
  expect(hijri.v).toBe('1444-08-23');
  expect(formatWithCode(hijri.v,hijri.s.code)).toBe('1444-08-23');
  const thai = read('[THA][$-7041E]yyyy-mm-dd','2566-03-15');
  expect(thai.v).toBe(243327);
  expect(formatWithCode(thai.v,thai.s.code)).toBe('3109-03-15');
});

it('does not treat HTML-only markers as valid XLSX directives or replace quoted labels', () => {
  expect(formatCodeError('[HIJ]yyyy')).toBeTruthy();
  expect(formatCodeError('[THA]yyyy')).toBeTruthy();
  expect(formatCodeError('[JPN]yyyy')).toBeTruthy();
  expect(formatCodeError('[TWN]yyyy')).toBeTruthy();
  expect(formatCodeError('[ENG]yyyy')).toBeTruthy();
  expect(read('"[HIJ]"0','[HIJ]5',5).s.code).toBe('"[HIJ]"0');
  expect(read('"[THA]"0','[THA]5',5).s.code).toBe('"[THA]"0');
  expect(read('"[HIJ]0','x',5).s.code).toBe('"[HIJ]0');
  expect(read('"[JPN]"0','[JPN]5',5).s.code).toBe('"[JPN]"0');
  expect(read('"[TWN]"0','[TWN]5',5).s.code).toBe('"[TWN]"0');
  expect(read('"[ENG]"0','[ENG]5',5).s.code).toBe('"[ENG]"0');
  expect(read('[JPN][$-411]"yy"\\y_y*y yy;yy', 'yy', 45000).s.code).toBe('[$-411]"yy"\\y_y*y ee;yy');
});

it('exports Taiwanese and English HTML hints as valid XLSX calendar formats', async () => {
  const codes = ['[TWN][$-40409]yyyy mmmm ddd', '[ENG][<0][$-40409]mmmm;[ENG]mmmm'];
  const cells = {};
  for (const [r, code] of codes.entries()) cells[`${r},0`] = read(code, '三月', 45000);
  const wb = new Workbook({ sheets: [{ name: 'Calendars', cells }] });
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const sheet = X.read(bytes, { type: 'array', cellNF: true }).Sheets.Calendars;
  for (let r = 0; r < codes.length; r++) {
    expect(sheet[`A${r+1}`].v).toBe(45000);
    expect(sheet[`A${r+1}`].z).toBe(styleToNumFmt(cells[`${r},0`].s));
    expect(formatCodeError(sheet[`A${r+1}`].z)).toBeNull();
    expect(sheet[`A${r+1}`].z).not.toMatch(/\[(?:TWN|ENG)\]/);
  }
});

it('exports Japanese HTML calendar formats as valid native XLSX codes', async () => {
  const cell = read('[JPN][DBNum1][$-411]ggg y"年"m"月"d"日"', '令和 五年三月十五日');
  expect(cell.v).toBe('令和 五年三月十五日');
  const code = styleToNumFmt(cell.s);
  expect(code).toBe('[DBNum1][$-411]ggg e"年"m"月"d"日"');
  expect(formatCodeError(code)).toBeNull();
  const wb = new Workbook({ sheets: [{ name: 'Era', cells: { '0,0': cell, '1,0': { ...cell, v: 45000 } } }] });
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const exported = X.read(bytes, { type: 'array', cellNF: true });
  expect(exported.Sheets.Era.A1.z).toBe(code);
  expect(exported.Sheets.Era.A1.v).toBe(cell.v);
  expect(exported.Sheets.Era.A2.z).toBe(code);
  expect(exported.Sheets.Era.A2.v).toBe(45000);
});
