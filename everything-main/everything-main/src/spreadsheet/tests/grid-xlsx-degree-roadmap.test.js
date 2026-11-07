// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { degreeRoadmapXlsx } from './helpers/xlsx-degree-roadmap-fixture.js';

let glyphWidth = 7;
beforeEach(() => {
  glyphWidth = 7;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1100 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * glyphWidth }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});

it.each(['calibri', 'cambria'])('remeasures overflow after the %s fallback finishes loading', async font => {
  const fonts = new EventTarget();
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  glyphWidth = 20;
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * glyphWidth }), font: '' });
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Font loading check');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { font, size: 44 / 3 });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  try {
    document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(grid.el.querySelector('#gc-0-0').classList.contains('spill')).toBe(true);
    glyphWidth = 3;
    fonts.dispatchEvent(new Event('loadingdone'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(grid.el.querySelector('#gc-0-0').classList.contains('spill')).toBe(false);
  } finally { grid.destroy(); delete document.fonts; }
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('renders readable course headers with the workbook font, compact spacing, and no phantom filter buttons', async () => {
  const wb = await workbookFromFile(degreeRoadmapXlsx(), 'roadmap.xlsx'), id = wb.activeSheetId;
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  try {
    document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 20));
    const header = grid.el.querySelector('#gc-22-1');
    expect(header.textContent).toBe('Course Subject Prefix (e.g. ECE or PHYS)');
    expect(header.style.fontFamily).toContain('Calibri, Carlito');
    expect(header.style.fontSize).toBe('14.67px');
    expect(header.style.color).toBe('rgb(0, 0, 0)');
    expect(header.style.backgroundColor).toBe('rgb(237, 237, 237)');
    expect(header.classList.contains('calibri')).toBe(true);
    expect(header.classList.contains('filter-head')).toBe(false);
    const merged = grid.el.querySelector('#gc-7-0');
    expect(merged.getAttribute('aria-rowspan')).toBe('5');
    expect(merged.style.width).toBe('349px');
    const print = buildPrintTable(wb, id);
    const printed = [...print.querySelectorAll('td')].find(td => td.textContent === header.textContent);
    expect(printed.style.fontFamily).toContain('Calibri, Carlito');
    expect(printed.style.color).toBe('rgb(0, 0, 0)');
    expect(printed.querySelector('.print-cell').style.padding).toBe('0px 2px');
  } finally { grid.destroy(); }
});
