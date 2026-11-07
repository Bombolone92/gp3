// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { declared, stylesheet } from './helpers/css.js';

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

it('covers gridlines with direct, inherited, table and conditional fills while preserving explicit borders', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: '#ffffff' });
  wb.applyBorders(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'outer', { style: 'double', color: '#ff0000' });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bg: 'transparent' });
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bg: 'rgba(0,0,0,0)' });
  wb.applyStyle(id, { r1: 0, c1: 2, r2: wb.activeSheet.rows - 1, c2: 2 }, { bg: '#aabbcc' });
  wb.addRule(id, { range: { r1: 3, c1: 0, r2: 3, c2: 0 }, type: 'empty', style: { bg: '#ffff00' } });
  wb.setInput(id, 5, 0, 'Name'); wb.setInput(id, 5, 1, 'Count');
  wb.addTable(id, { r1: 5, c1: 0, r2: 8, c2: 1 });
  wb.mergeCells(id, { r1: 10, c1: 0, r2: 11, c2: 1 });
  wb.applyStyle(id, { r1: 10, c1: 0, r2: 11, c2: 1 }, { bg: '#abcdef' });
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el);
  try {
    await flush();
    const cell = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
    for (const [r, c] of [[0, 0], [3, 0], [5, 0], [6, 1], [10, 0], [15, 2]]) expect(cell(r, c).classList.contains('filled'), `${r},${c}`).toBe(true);
    for (const r of [1, 2, 4]) expect(cell(r, 0).classList.contains('filled')).toBe(false);
    expect(cell(0, 0).classList.contains('bb')).toBe(true);
    expect(cell(0, 0).style.borderBottomStyle).toBe('double');
    expect(cell(0, 0).style.borderBottomColor).toBe('rgb(255, 0, 0)');
    expect(cell(10, 0).getAttribute('aria-colspan')).toBe('2');
    expect(declared(stylesheet('grid.css'), '.cell.filled:not(.spill)')['--grid-line']).toBe('transparent');
    const print = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 11, c2: 2 } });
    expect(print.rows[0].cells[0].classList.contains('filled')).toBe(true);
    expect(print.rows[0].cells[0].style.borderBottom).toBe('3px double rgb(255, 0, 0)');
    expect(print.rows[3].cells[0].classList.contains('filled')).toBe(true);
    expect(print.rows[6].cells[1].classList.contains('filled')).toBe(true);
    expect(print.rows[1].cells[0].classList.contains('filled')).toBe(false);
    expect(declared(stylesheet('editor.css'), '.print-table td.filled').border).toBe('none');
    expect(print.rows[3].cells[0].style.backgroundColor).toBe('rgb(255, 255, 0)');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: null });
    await flush();
    expect(cell(0, 0).classList.contains('filled')).toBe(false);
    expect(cell(0, 0).style.borderBottomStyle).toBe('double');
    expect(cell(0, 0).style.borderBottomColor).toBe('rgb(255, 0, 0)');
    wb.undo(); await flush();
    expect(cell(0, 0).classList.contains('filled')).toBe(true);
  } finally { grid.destroy(); }
});

it('prints blank table bands even when the sheet has no conditional rules', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Name'); wb.setInput(id, 0, 1, 'Count');
  wb.addTable(id, { r1: 0, c1: 0, r2: 4, c2: 1 });
  const print = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 4, c2: 1 } });
  expect(print.rows[1].cells[1].classList.contains('filled')).toBe(true);
  expect(print.rows[1].cells[1].style.backgroundColor).toBe('rgb(217, 225, 242)');
  expect(print.rows[2].cells[1].classList.contains('filled')).toBe(false);
});

it.each(['left', 'center', 'right'])('keeps gridlines under unfilled cells beside a %s-aligned overflowing filled label', async align => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 2, 3, 'An overflowing invoice description');
  wb.applyStyle(id, { r1: 2, c1: 3, r2: 2, c2: 3 }, { bg: '#ffff00', align });
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el);
  try {
    await flush();
    const cell = grid.el.querySelector('#gc-2-3');
    expect(cell.classList.contains('spill-over-fill')).toBe(true);
    expect(cell.classList.contains('filled')).toBe(true);
    expect(cell.style.getPropertyValue('--spill-own')).toBe('100px');
    expect(parseFloat(cell.style.getPropertyValue('--spill-opaque'))).toBeGreaterThan(100);
    const css = stylesheet('grid.css'), fill = declared(css, '.cell.spill.spill-over-fill');
    expect(fill['--spill-lines']).toContain('--spill-opaque');
    expect(fill.background.indexOf('--spill-bg')).toBeLessThan(fill.background.indexOf('--spill-lines'));
    expect(fill['border-bottom-color']).toBe('transparent');
    expect(fill['background-origin']).toBe('border-box');
    expect(declared(css, '.grid.no-gridlines .cell.spill.spill-over-fill')['--spill-line']).toBe('transparent');
  } finally { grid.destroy(); }
});
