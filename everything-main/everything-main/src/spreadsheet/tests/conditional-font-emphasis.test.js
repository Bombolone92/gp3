// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxDifferentialStyle } from '../src/core/xlsx-styles.js';
import { conditionalFontStyle } from '../src/core/style-values.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { measureRows } from '../src/core/row-height.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
let grid;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { grid?.destroy(); grid = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
const flags = value => ({ bold: value, italic: value, underline: value, strike: value });
function book(base, style) {
  return new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Emphasis', s: base } }, rules: [{ type: 'formula', value: 'TRUE', range, style }] }] });
}
it.each(['', ' val="1"', ' val="true"', ' val="0"', ' val="false"'])('reads differential emphasis flags and explicit resets (%s)', attrs => {
  const on = !/"(?:0|false)"/.test(attrs);
  expect(readXlsxDifferentialStyle(`<dxf><font><b${attrs}/><i${attrs}/><strike${attrs}/></font></dxf>`)).toMatchObject({ bold: on, italic: on, strike: on });
  expect(readXlsxDifferentialStyle('<dxf><font><color rgb="FF123456"/></font></dxf>')).not.toHaveProperty('italic');
});
it.each([['<u/>', true], ['<u val="single"/>', true], ['<u val="none"/>', false]])('retains the single underline setting %s', (xml, underline) => {
  expect(readXlsxDifferentialStyle(`<dxf><font>${xml}</font></dxf>`).underline).toBe(underline);
});
it('composes flags without mutating inputs or changing fill/border precedence', () => {
  const base = { ...flags(true), bg: '#123456', size: 15 }, conditional = { ...flags(false), bg: '#abcdef' };
  expect(conditionalFontStyle(base, conditional)).toEqual({ ...base, ...flags(false) });
  expect(base.bold).toBe(true); expect(conditionalFontStyle(base, null)).toBe(base);
});
it.each([true, false])('renders conditional emphasis %s consistently in grid, print and external HTML', async value => {
  const wb = book(flags(!value), flags(value)), id = wb.activeSheetId;
  grid = createGrid({ wb, sheetId: id, announce() {} }); document.body.append(grid.el);
  await new Promise(resolve => setTimeout(resolve, 10));
  const cell = grid.el.querySelector('#gc-0-0');
  for (const key of ['b', 'i', 'u', 's']) expect(cell.classList.contains(key)).toBe(value);
  const td = [...buildPrintTable(wb, id, { fit: 'actual' }).querySelectorAll('td')].find(td => td.textContent === 'Emphasis');
  expect(td.style.fontWeight).toBe(value ? '600' : '400');
  expect(td.style.fontStyle).toBe(value ? 'italic' : '');
  expect(td.style.textDecoration).toBe(value ? 'underline line-through' : '');
  const html = cellsToHtml([['Emphasis']], [[wb.getCell(id, 0, 0)]], [[wb.conditionalStyle(id, 0, 0, 'Emphasis')]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(parseHtmlClipboard(html).rows[0][0].style).toMatchObject(flags(value));
});
it('clears an underline without suppressing a retained strike', async () => {
  const wb = book({ underline: true, strike: true }, { underline: false });
  grid = createGrid({ wb, sheetId: wb.activeSheetId, announce() {} }); document.body.append(grid.el);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(grid.el.querySelector('#gc-0-0').style.textDecoration).toBe('line-through');
});
it('uses the conditional font reset for automatic row measurement', () => {
  const wb = book({ bold: true, italic: true, wrap: true }, { bold: false, italic: false }), fonts = [];
  measureRows(wb, wb.activeSheetId, 0, 0, { force: true, textWidth: (text, font) => { fonts.push(font); return text.length * 7; } });
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every(font => !font.includes('italic') && !font.includes('600'))).toBe(true);
});
it('preserves flags through native-only XLSX export, import and internal rule copying', async () => {
  let wb = book(flags(true), flags(false));
  for (let pass = 0; pass < 2; pass++) {
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(wb.activeSheet.rules[0].style).toMatchObject(flags(false));
  }
  const id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyRange(id, range), 2, 2, { r: 0, c: 0 }, null, { conditionalFormats: wb.copyConditionalFormats(id, [0], [0]) });
  expect(wb.conditionalStyle(id, 2, 2, 'Emphasis')).toMatchObject(flags(false));
});
it('keeps custom table emphasis while respecting concrete direct overrides', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Header' }, '1,0': { v: 'Body', s: { italic: false, strike: false } } },
    tables: [{ name: 'Entries', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, style: 'custom', customStyle: { wholeTable: { italic: true, strike: true, underline: true } } }] }] });
  expect(wb.conditionalStyle(wb.activeSheetId, 0, 0, 'Header')).toMatchObject({ italic: true, strike: true, underline: true });
  expect(wb.conditionalStyle(wb.activeSheetId, 1, 0, 'Body')).toMatchObject({ italic: false, strike: false, underline: true });
});

it('normalizes boolean whitespace and rejects malformed differential emphasis', () => {
  expect(readXlsxDifferentialStyle('<dxf><font><i val=" 0 "/><strike val=" true "/></font></dxf>')).toEqual({ italic: false, strike: true });
  expect(() => readXlsxDifferentialStyle('<dxf><font><i val="yes"/></font></dxf>')).toThrow(/font flag/);
});
