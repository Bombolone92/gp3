// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { stampClipboardHtml } from './helpers/clipboard.js';

const theme = { theme: 4, base: '#286844', rgb: '#286844' };
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

it('paints reference fills consistently in cells, inherited lines, conditional/table regions and print, including undo', async () => {
  const wb = new Workbook({ sheets: [{ colStyles: { 2: { bg: theme } }, rowStyles: { 3: { bg: theme } },
    cells: { '0,0': { v: 'Direct', s: { bg: theme } }, '5,0': { v: 'Header' }, '6,0': { v: 1 } },
    tables: [{ name: 'Items', style: 'custom', customStyle: { headerRow: { bg: theme } }, range: parseRange('A6:B8') }],
  }] }), id = wb.activeSheetId;
  wb.addRule(id, { range: parseRange('A5'), type: 'empty', style: { bg: theme } });
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el);
  try {
    await flush();
    const print = buildPrintTable(wb, id, { range: parseRange('A1:C9') });
    for (const [r, c] of [[0, 0], [8, 2], [3, 1], [4, 0], [5, 0]]) {
      const cell = grid.el.querySelector(`#gc-${r}-${c}`);
      expect(cell.style.backgroundColor, `${r},${c}`).toBe('rgb(40, 104, 68)');
      expect(cell.classList.contains('filled')).toBe(true);
      expect(print.rows[r].cells[c].style.backgroundColor).toBe('rgb(40, 104, 68)');
    }
    wb.applyStyle(id, parseRange('A1'), { bg: null }); await flush();
    expect(grid.el.querySelector('#gc-0-0').classList.contains('filled')).toBe(false);
    wb.undo(); await flush();
    expect(grid.el.querySelector('#gc-0-0').style.backgroundColor).toBe('rgb(40, 104, 68)');
  } finally { grid.destroy(); }
});

it('copies native fill identity internally and exposes resolved paint to other spreadsheet applications', () => {
  const wb = new Workbook({ sheets: [{ cells: { '1,1': { v: 'Copied', s: { bg: theme } } } }] });
  const html = cellsToHtml([['Copied']], [[wb.getCell(wb.activeSheetId, 1, 1)]]);
  expect(html).toContain('background-color:#286844');
  const parsed = parseHtmlClipboard(html);
  expect(parsed.cells[0][0].s.bg).toEqual(theme);
  wb.pasteCells(wb.activeSheetId, parsed.cells, 4, 5);
  expect(wb.styleAt(wb.activeSheetId, 4, 5).bg).toEqual(theme);
  const external = html.replace(/ data-spreadsheet-\w+="[^"]*"/g, '');
  expect(parseHtmlClipboard(external).rows[0][0].style.bg).toBe('#286844');
});

it('filters by the displayed color of a reference fill and identical RGB fill', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Header' },
    '1,0': { v: 'Theme', s: { bg: theme } }, '2,0': { v: 'RGB', s: { bg: '#286844' } }, '3,0': { v: 'Plain' } } }] });
  const id = wb.activeSheetId;
  wb.setFilterRange(id, parseRange('A1:A4'));
  expect(wb.filterColors(id, 0)).toEqual([{ color: '#286844', count: 2 }, { color: '', count: 1 }]);
  wb.setFilterCriteria(id, 0, { color: '#286844' });
  expect([1, 2, 3].filter(r => !wb.isRowHidden(id, r))).toEqual([1, 2]);
});

it.each([{ theme: 4, base: '#000000', rgb: 'url(https://example.com)' }, { indexed: 99, base: '#000000', rgb: '#000000' }])
('drops an invalid embedded fill reference at the clipboard trust boundary: %j', bg => {
  const html = stampClipboardHtml(`<table data-spreadsheet-cells='${JSON.stringify([[{ v: 'Value', s: { bg, bold: true } }]])}'><tr><td>Shown</td></tr></table>`);
  const parsed = parseHtmlClipboard(html);
  expect(JSON.stringify(parsed)).not.toContain('url(');
  expect(parsed.cells?.[0]?.[0]?.s?.bg).toBeUndefined();
});
