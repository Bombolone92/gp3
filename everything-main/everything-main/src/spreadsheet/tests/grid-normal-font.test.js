// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { normalIndentUnit } from '../src/core/normal-font.js';
import * as S from '../src/core/selection.js';

let grid, spaceWidth;
beforeEach(() => {
  spaceWidth = 7;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t === ' ' ? spaceWidth : t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { grid?.destroy(); grid = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('uses the inherited font in a blank cell editor, rendered input and print', () => {
  const wb = new Workbook({ normalFont: { name: 'Georgia', sz: 15, bold: true, italic: true } }), id = wb.activeSheetId;
  grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.append(grid.el);
  grid.setSelection(S.single(3, 2));
  grid.beginEdit();
  const editor = grid.el.querySelector('.grid-editor');
  expect(editor.style.fontFamily).toContain('Georgia');
  expect(editor.style.fontSize).toBe('20px');
  expect(editor.style.fontWeight).toBe('600');
  expect(editor.style.fontStyle).toBe('italic');
  grid.cancelEdit();
  wb.setInput(id, 3, 2, 'Inherited text');
  const printed = buildPrintTable(wb, id, { fit: 'actual' });
  const text = [...printed.querySelectorAll('td')].find(td => td.textContent === 'Inherited text');
  expect(text.style.fontFamily).toContain('Georgia');
  expect(text.style.fontSize).toBe('20px');
});

it('round-trips inherited font formatting through external HTML without private clipboard data', () => {
  const wb = new Workbook({ normalFont: { name: 'Courier New', sz: 14, bold: true } }), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Text');
  const cells = wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 });
  const html = cellsToHtml([['Text']], cells).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
  expect(pasted.s).toMatchObject({ font: 'courier', bold: true });
  expect(pasted.s.size).toBeCloseTo(56 / 3, 12);
  const incoming = cellsFromHtmlRows(parseHtmlClipboard('<table><tr><td style="font-family:Georgia;font-size:18pt;font-weight:normal">External</td></tr></table>').rows)[0].cell;
  wb.pasteCells(id, [[incoming]], 1, 0);
  expect(wb.styleAt(id, 1, 0)).toMatchObject({ font: 'georgia', size: 24, bold: false });
});

it.each(['normal', '400', '500'])('retains explicit font resets from external HTML: %s', weight => {
  const wb = new Workbook({ normalFont: { name: 'Arial', sz: 10, bold: true, italic: true, underline: 'single', strike: true, color: '#ab1234' } }), id = wb.activeSheetId;
  const html = `<table><tr><td style="font-weight:${weight};font-style:normal;text-decoration:none;color:#000000">Plain</td></tr></table>`;
  const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
  wb.pasteCells(id, [[cell]], 0, 0);
  const style = wb.styleAt(id, 0, 0);
  expect(style).toMatchObject({ bold: false, italic: false, underline: false, strike: false, color: '#000000' });
  const copied = cellsToHtml([['Plain']], wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 })).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = cellsFromHtmlRows(parseHtmlClipboard(copied).rows)[0].cell;
  // Default font/size may be omitted from HTML. A full paste must still
  // replace custom Normal defaults when the fragment returns.
  wb.pasteCells(id, [[parsed]], 1, 0);
  expect(wb.styleAt(id, 1, 0)).toMatchObject(style);
});

it.each([0.5, 1, 2])('uses Normal-font indentation for grid, editing, print and external HTML at zoom %s', async zoom => {
  const wb = new Workbook({ normalFont: { name: 'Courier New', sz: 12 }, sheets: [{ cells: {
    '0,0': { v: 'Left', s: { font: 'arial', size: 11, indent: 1, wrap: true } },
    '0,1': { v: 'Right', s: { font: 'georgia', size: 20, indent: 2, align: 'right', wrap: true } },
    '0,2': { v: 'Center', s: { indent: 3, align: 'center', wrap: true } },
  } }] }), id = wb.activeSheetId;
  grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.append(grid.el);
  grid.setZoom(zoom);
  await new Promise(resolve => setTimeout(resolve, 10));
  const unit = normalIndentUnit(wb.normalFont);
  expect(grid.indentUnit).toBe(unit);
  expect(grid.el.querySelector('#gc-0-0').style.paddingLeft).toBe(`${(unit + 2) * zoom}px`);
  expect(grid.el.querySelector('#gc-0-1').style.paddingRight).toBe(`${(2 * unit + 2) * zoom}px`);
  expect(grid.el.querySelector('#gc-0-2').style.paddingLeft).toBe('');
  grid.setSelection(S.single(0, 1)); grid.beginEdit();
  expect(grid.el.querySelector('.grid-editor').style.paddingRight).toBe(`${(2 * unit + 2) * zoom}px`);
  grid.cancelEdit();
  const table = buildPrintTable(wb, id, { fit: 'actual' });
  expect(table.querySelectorAll('.print-cell')[0].style.paddingLeft).toBe(`${unit + 2}px`);
  expect(table.querySelectorAll('.print-cell')[1].style.paddingRight).toBe(`${2 * unit + 2}px`);
  const html = cellsToHtml([['Left', 'Right', 'Center']], wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 2 }), null, null, null, { indentUnit: grid.indentUnit }).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows);
  expect(pasted.map(x => x.cell.s.indent || 0)).toEqual([1, 2, 0]);
  expect(html).toContain(`padding-left:${unit + 2}px`);
});

it('loads a Normal-only face once and invalidates its cached indentation when ready', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
  const fonts = new EventTarget(); fonts.load = vi.fn(() => Promise.resolve([]));
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  spaceWidth = 4;
  try {
    const wb = new Workbook({ normalFont: { name: 'Normal face control', sz: 12 }, sheets: [{ cells: {
      '0,0': { v: 'Text', s: { font: 'arial', size: 13, indent: 1 } },
    } }] });
    grid = createGrid({ wb, sheetId: wb.activeSheetId }); document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(grid.el.querySelector('#gc-0-0').style.paddingLeft).toBe('14px');
    expect(grid.indentUnit).toBe(12); expect(grid.indentUnit).toBe(12);
    expect(fonts.load).toHaveBeenCalledTimes(1);
    expect(fonts.load.mock.calls[0][1]).toBe(' ');
    spaceWidth = 8; fonts.dispatchEvent(new Event('loadingdone'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(grid.indentUnit).toBe(24);
    expect(grid.el.querySelector('#gc-0-0').style.paddingLeft).toBe('26px');
    expect(fonts.load).toHaveBeenCalledTimes(1);
  } finally {
    grid?.destroy(); grid = null;
    if (descriptor) Object.defineProperty(document, 'fonts', descriptor); else delete document.fonts;
  }
});
