// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { codeColor } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, sheetToHtml } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import * as X from '../src/vendor/xlsx.mjs';
import native from './fixtures/reference-format-colors.json';

const palette = { indexed: native.indexed };
const format = name => `[${name}]0;[${name}]-0;[${name}]0;[${name}]@`;
const cssColor = hex => { const e = document.createElement('span'); e.style.color = hex; return e.style.color; };
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 2400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
});
afterEach(() => document.body.replaceChildren());

it('matches all native named and numbered colors for numbers, text and Booleans', () => {
  for (const [name, standard, custom] of native.cases) {
    for (const value of [123, 'label', true]) {
      expect(codeColor(value, format(name)), name).toBe(standard);
      expect(codeColor(value, format(name), palette), name).toBe(custom);
      expect(codeColor(value, format(name)), `${name}: cached across workbooks`).toBe(standard);
    }
  }
});

it('resolves selected sections against the current palette without caching another workbook’s paint', () => {
  const code = '[Color56]0;[Red]-0;[Color10]0;[Blue]@';
  expect(codeColor(-1, code, palette)).toBe('#ff0000');
  expect(codeColor('label', code, palette)).toBe('#0000ff');
  expect(codeColor(0, code, palette)).toBe(native.indexed[17]);
  const changing = { indexed: [] };
  expect(codeColor(1, code, changing)).toBe('#333333');
  changing.indexed[63] = '#A1B2C3';
  expect(codeColor(1, code, changing)).toBe('#a1b2c3');
  changing.indexed[63] = 'url(bad)';
  expect(codeColor(1, code, changing)).toBe('#333333');
  expect(codeColor(-.1, '[Color56][<=0]0;[Color10]General', palette)).toBe(native.indexed[17]);
  for (const value of [null, undefined, { error: '#N/A' }]) expect(codeColor(value, code, palette)).toBeNull();
});

it('shares exact palette colors across the grid, print and web export, including formula and inherited styles', async () => {
  const wb = new Workbook({ colorPalette: palette }), id = wb.activeSheetId;
  for (const [r, [name]] of native.cases.entries()) {
    wb.setInput(id, r, 0, '=123');
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { fmt: 'custom', code: format(name), color: '#123456' });
  }
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.append(grid.el);
  await new Promise(resolve => setTimeout(resolve, 10));
  const print = buildPrintTable(wb, id, { headers: false });
  const html = new DOMParser().parseFromString(sheetToHtml(wb, id), 'text/html');
  for (const [r, [name, , expected]] of native.cases.entries()) {
    expect(grid.el.querySelector(`#gc-${r}-0`).style.color, `${name}: grid`).toBe(cssColor(expected));
    expect(print.querySelectorAll('td')[r].style.color, `${name}: print`).toBe(cssColor(expected));
    expect(html.querySelectorAll('td')[r].querySelector('font').getAttribute('color'), `${name}: HTML`).toBe(expected);
  }
  grid.destroy();
  const inherited = new Workbook({ colorPalette: palette, sheets: [{ cells: { '0,0': { v: 42 } }, colStyles: { 0: { fmt: 'custom', code: '[Color56]0' } } }] });
  expect(sheetToHtml(inherited, inherited.activeSheetId)).toContain(`color="${native.indexed[63]}"`);
});

it('keeps conditional font colors above format colors in grid, print and HTML', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '123');
  wb.applyStyle(id, { r1: 0, r2: 0, c1: 0, c2: 0 }, { fmt: 'custom', code: '[Red]0', color: '#123456' });
  wb.addRule(id, { range: { r1: 0, r2: 0, c1: 0, c2: 0 }, type: 'gt', value: 0, style: { color: '#abcdef' } });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.append(grid.el);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(grid.el.querySelector('#gc-0-0').style.color).toBe(cssColor('#abcdef'));
  expect(buildPrintTable(wb, id, { headers: false }).querySelector('td').style.color).toBe(cssColor('#abcdef'));
  const html = new DOMParser().parseFromString(sheetToHtml(wb, id), 'text/html');
  expect(html.querySelector('td').style.color).toBe(cssColor('#abcdef'));
  expect(html.querySelector('font')).toBeNull();
  grid.destroy();
});

it('keeps the base font color and live format in external HTML and metadata-free XLSX', async () => {
  const wb = new Workbook({ colorPalette: palette }), id = wb.activeSheetId;
  const cell = { v: 123, f: null, s: { fmt: 'custom', code: '[Color56]0', color: '#123456' } };
  wb.setCells(id, [{ r: 0, c: 0, cell }]);
  const html = cellsToHtml([['123']], [[cell]], null, [[123]], null, { colorPalette: palette })
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(html).toContain(`color="${native.indexed[63]}" style="mso-ignore:color"`);
  const restored = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
  expect(restored.v).toBe(123);
  expect(restored.s.color).toBe('#123456');
  expect(restored.s.code).toBe('[Color56]0');
  expect(codeColor(restored.v, restored.s.code)).toBe('#333333');
  const cf = cellsToHtml([['123']], [[cell]], [[{ color: '#abcdef' }]], [[123]], null, { colorPalette: palette });
  expect(cf).not.toContain('<font');
  expect(cf).toContain('color:#abcdef');
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(data, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'palette.xlsx');
  const style = back.styleAt(back.activeSheetId, 0, 0);
  expect(style.code).toBe('[Color56]0');
  expect(style.color).toBe('#123456');
  expect(codeColor(back.getValue(back.activeSheetId, 0, 0), style.code, back.colorPalette)).toBe(native.indexed[63]);
});
