// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { chartSheetLayout } from '../src/core/chartsheet.js';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { buildPrintSheet } from '../src/ui/print.js';

let width, height, grid;
beforeEach(() => {
  width = 800; height = 400;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function () {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id));
});
afterEach(() => { grid?.destroy(); grid = null; vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
const key = (k, options = {}) => grid.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...options }));
function setup(fit = true) {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 5 }, '1,0': { v: 12 } } },
    { name: 'Overview', kind: 'chart', zoomToFit: fit, charts: [{ type: 'column', title: 'Results', anchor: { r: 0, c: 0 }, w: 600, h: 300, range: { r1: 0, c1: 0, r2: 1, c2: 0 },
      sourceRefs: [{ name: 'Values', values: 'Data!$A$1:$A$2' }] }] }] });
  const commands = [], id = wb.sheets[1].id;
  grid = createGrid({ wb, sheetId: id, onCommand: (...args) => commands.push(args) });
  document.body.append(grid.el);
  return { wb, id, commands };
}

it('renders a cell-free accessible chart surface, fits on resize, and restores the worksheet grid', async () => {
  const { wb, id } = setup(); await flush();
  expect(grid.viewport.getAttribute('role')).toBe('region');
  expect(grid.viewport.getAttribute('aria-label')).toBe('Overview chart sheet');
  expect(grid.viewport.hasAttribute('aria-activedescendant')).toBe(false);
  expect(grid.el.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
  expect(grid.el.querySelector('.chart-box').style.width).toBe('800px');
  width = 360; height = 600; grid.refresh(); await flush();
  expect(grid.el.querySelector('.chart-box').style.width).toBe('360px');
  expect(grid.el.querySelector('.chart-box').style.height).toBe('180px');
  grid.setSheet(wb.sheets[0].id); await flush();
  expect(grid.viewport.getAttribute('role')).toBe('grid');
  expect(grid.el.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
  grid.setSheet(id); await flush();
  expect(grid.el.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
});

it('supports chart selection, editing, picture copy and sheet navigation without starting a cell edit', async () => {
  const { wb, id, commands } = setup(); await flush();
  key('x'); key('F2');
  expect(grid.editing).toBe(false); expect(wb.sheet(id).cells.size).toBe(0);
  key('ArrowRight'); expect(grid.selectedChart).toBe(wb.sheet(id).charts[0].id);
  key('Enter'); expect(commands.at(-1)).toEqual(['editChart', grid.selectedChart]);
  key('c', { ctrlKey: true, metaKey: true }); expect(commands.at(-1)).toEqual(['copyChart', { id: grid.selectedChart }]);
  key('ArrowDown', { altKey: true }); expect(commands.at(-1)).toEqual(['sheet', 'next']);
  const before = grid.el.querySelector('.chart-body').innerHTML;
  wb.setInput(wb.sheets[0].id, 0, 0, '25'); await flush();
  expect(grid.el.querySelector('.chart-body').innerHTML).not.toBe(before);
});

it('uses explicit zoom when fit is off and leaves fit mode on a user zoom change', async () => {
  const { wb, id } = setup(); await flush();
  grid.setZoom(1.5, true); await flush(); // importing a scale does not cancel fit
  expect(wb.sheet(id).zoomToFit).toBe(true);
  expect(grid.el.querySelector('.chart-box').style.width).toBe('800px');
  grid.setZoom(1.5); await flush();
  expect(wb.sheet(id).zoomToFit).toBe(false);
  expect(grid.el.querySelector('.chart-box').style.width).toBe('900px');
});

it('fits arbitrary absolute drawings without changing their stored sizes', () => {
  const sheet = { zoomToFit: true, charts: [{ dx: 20, dy: 40, w: 400, h: 200 }, { dx: 500, dy: 10, w: 100, h: 70 }] };
  expect(chartSheetLayout(sheet, 300, 300)).toEqual({ scale: .5, width: 300, height: 120 });
  expect(chartSheetLayout({ ...sheet, zoomToFit: false }, 300, 300, 1.25)).toEqual({ scale: 1.25, width: 750, height: 300 });
  expect(chartSheetLayout({ charts: [], zoomToFit: true }, 0, 0)).toEqual({ scale: 1, width: 1, height: 1 });
});

it('prints a chart canvas without cells and disables cell-only menu commands', () => {
  const { wb, id } = setup();
  const printed = buildPrintSheet(wb, id, { paper: 'a4', orientation: 'landscape', margins: 'normal' });
  expect(printed.querySelector('table')).toBeNull();
  expect(printed.querySelectorAll('svg')).toHaveLength(1);
  expect(Number(printed.style.zoom)).toBeGreaterThan(0);
  const leaves = menubarMenus({ chartSheet: true, chart: 'c1', canUndo: true, pick: true }).flatMap(menu => menuLeaves(menu.items));
  expect(leaves.filter(item => ['merge', 'bold', 'validation', 'downloadCsv'].includes(item.cmd)).every(item => item.disabled)).toBe(true);
  expect(leaves.find(item => item.cmd === 'downloadXlsx').disabled).not.toBe(true);
  expect(leaves.find(item => item.cmd === 'undo').disabled).not.toBe(true);
  expect(leaves.find(item => item.cmd === 'insertImagePuter').disabled).not.toBe(true);
  expect(leaves.find(item => item.cmd === 'moveOrCopySheet').disabled).not.toBe(true);
});
