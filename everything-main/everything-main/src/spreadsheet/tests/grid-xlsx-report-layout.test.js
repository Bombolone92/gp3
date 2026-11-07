// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { reportXlsx } from './helpers/xlsx-report-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1600; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 1000; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});
afterEach(() => document.body.replaceChildren());

it('draws the report with centered wrapped headings and table borders under direct cell fills', async () => {
  const wb = await workbookFromFile(reportXlsx(), 'report.xlsx');
  const grid = createGrid({ wb, sheetId: wb.activeSheetId, announce() {} });
  try {
    document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 20));
    const cell = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
    expect(cell(2, 2).style.fontFamily).toContain('Rockwell');
    expect(cell(2, 2).style.width).toBe('630px');
    expect(cell(2, 2).style.height).toBe('168px');
    expect(cell(2, 2).classList.contains('wrap')).toBe(true);
    expect(cell(11, 9).classList.contains('vm')).toBe(true);
    expect(cell(11, 9).classList.contains('ac')).toBe(true);
    expect(cell(11, 9).classList.contains('filter-head')).toBe(false);
    expect(cell(11, 9).style.color).toBe('rgb(255, 238, 215)');
    expect(cell(12, 2).style.backgroundColor).toBe('rgb(255, 238, 215)');
    expect(cell(13, 2).style.backgroundColor).toBe('rgb(254, 232, 193)');
    expect(cell(13, 3).style.backgroundColor).toBe('rgb(255, 221, 175)');
    expect(cell(13, 3).style.borderBottomColor).toBe('rgb(19, 86, 121)');
    expect(cell(13, 3).style.borderRightColor).toBe('rgb(255, 238, 215)');
    expect(cell(13, 4).style.backgroundColor).toBe('rgb(254, 232, 193)'); // no stored cell
    expect(cell(13, 4).style.borderBottomColor).toBe('rgb(19, 86, 121)');
    // Printing uses the same fill and border precedence for populated cells.
    const printed = buildPrintTable(wb, wb.activeSheetId);
    const sample = [...printed.querySelectorAll('td')].find(td => td.textContent === '3');
    expect(sample.style.backgroundColor).toBe('rgb(255, 221, 175)');
    expect(sample.style.borderBottom).toBe('');
    const below = sample.parentElement.nextElementSibling.cells[sample.cellIndex];
    expect(below.style.borderTop).toBe('1px solid rgb(19, 86, 121)');
  } finally { grid.destroy(); }
});
