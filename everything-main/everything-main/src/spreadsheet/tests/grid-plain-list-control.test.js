// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { createGrid, COL_HEADER_H } from '../src/ui/grid.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
// A default row on screen: each row is snapped to whole pixels at the zoom.
const rowAt = (zoom = 1) => Math.round(DEFAULT_ROW_HEIGHT * zoom);
const ROW = rowAt();
const A3_TOP = 2 * ROW; // the list cell A3's top on the canvas at 100%
async function mount({ frozen = false, chips = false, merged = false } = {}) {
  const wb = new Workbook(), id = wb.activeSheetId, opened = [];
  wb.setInput(id, 2, 0, 'A long label');
  wb.addValidation(id, { range: { r1: 2, c1: 0, r2: 3, c2: 0 }, type: 'list', source: 'A long label,Other', chips });
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 3, c2: 0 }, { align: 'right', indent: 1, wrap: true });
  if (frozen) wb.setFrozen(id, 0, 1);
  if (merged) wb.mergeCells(id, { r1: 2, c1: 0, r2: 2, c2: 1 });
  const grid = createGrid({ wb, sheetId: id, onListOpen: item => opened.push(item) });
  document.body.replaceChildren(grid.el);
  grid.selectByName('A3'); await flush();
  return { wb, id, grid, opened, button: grid.el.querySelector('.cell-list-button') };
}

it('opens the selected list without moving selection or reserving cell text width', async () => {
  const { grid, button, opened } = await mount();
  try {
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.style.transform).toBe(`translate(100px, ${A3_TOP}px)`);
    const cell = grid.el.querySelector('#gc-2-0');
    expect(cell.classList.contains('list-inline')).toBe(false);
    expect(cell.style.paddingRight).toBe('14px');
    grid.focus();
    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    button.dispatchEvent(press); button.click();
    expect(press.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(grid.viewport);
    expect(grid.selection.active).toEqual({ r: 2, c: 0 });
    expect(opened).toMatchObject([{ r: 2, c: 0, rule: { type: 'list' } }]);
    grid.selectByName('A4'); await flush(); button.click();
    expect(opened[1]).toMatchObject({ r: 3, c: 0 });
    grid.selectByName('B4'); await flush(); expect(button.hidden).toBe(true);
  } finally { grid.destroy(); }
});

it('hides during editing and restores after cancellation without changing the value', async () => {
  const { grid, button, wb, id, opened } = await mount();
  try {
    grid.beginEdit({ text: 'Other', mode: 'inplace' }); await flush(); expect(button.hidden).toBe(true);
    grid.cancelEdit(); await flush(); expect(button.hidden).toBe(false);
    expect(wb.getValue(id, 2, 0)).toBe('A long label');
    grid.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    expect(opened).toMatchObject([{ r: 2, c: 0 }]);
  } finally { grid.destroy(); }
});

it('keeps chip controls inline', async () => {
  const { grid, button } = await mount({ chips: true });
  try {
    expect(button.hidden).toBe(true);
    expect(grid.el.querySelector('#gc-2-0').classList.contains('list-inline')).toBe(true);
    expect(grid.el.querySelector('#gc-2-0 .chip')).not.toBeNull();
  } finally { grid.destroy(); }
});

it('gives visible filter buttons precedence over both kinds of list control', async () => {
  for (const chips of [false, true]) {
    const { grid, button, wb, id } = await mount({ chips });
    try {
      wb.setFilterRange(id, { r1: 2, c1: 0, r2: 3, c2: 0 }); await flush();
      expect(button.hidden).toBe(true);
      expect(grid.el.querySelector('#gc-2-0').classList.contains('filter-head')).toBe(true);
      expect(grid.el.querySelector('#gc-2-0').style.paddingRight).toBe('20px');
    } finally { grid.destroy(); }
  }
});

it('uses the merged cell boundary and tracks zoom without changing indentation', async () => {
  const { grid, button } = await mount({ merged: true });
  try {
    expect(button.style.transform).toBe(`translate(200px, ${A3_TOP}px)`);
    grid.setZoom(2); await flush();
    expect(button.style.transform).toBe(`translate(400px, ${2 * rowAt(2)}px)`);
    expect(grid.el.querySelector('#gc-2-0').style.paddingRight).toBe('28px');
  } finally { grid.destroy(); }
});

it('follows frozen cells, hides offscreen, and moves back into the scrolling canvas', async () => {
  const { grid, button, wb, id } = await mount({ frozen: true });
  try {
    expect(button.parentNode).toBe(grid.el);
    // Hosted by the grid itself, the button sits below the column header, where A3 is on the screen.
    expect(button.style.transform).toBe(`translate(148px, ${COL_HEADER_H + A3_TOP}px)`);
    grid.viewport.scrollTop = 30; grid.viewport.dispatchEvent(new Event('scroll'));
    expect(button.style.transform).toBe(`translate(148px, ${COL_HEADER_H + A3_TOP - 30}px)`);
    // Scrolled partway into row 3, the part of the button above the viewport is clipped.
    const partly = ROW / 2;
    grid.viewport.scrollTop = A3_TOP + partly; grid.viewport.dispatchEvent(new Event('scroll'));
    expect(button.style.clipPath).toBe(`inset(${partly}px 0 0px 0)`);
    grid.viewport.scrollTop = 300; grid.viewport.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('offscreen')).toBe(true);
    grid.viewport.scrollTop = 0; grid.viewport.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('offscreen')).toBe(false);
    expect(button.style.clipPath).toBe('inset(0px 0 0px 0)');
    expect(grid.el.querySelectorAll('.cell-list-button')).toHaveLength(1);
    wb.setFrozen(id, 0, 0); await flush();
    expect(button.parentNode).toBe(grid.el.querySelector('.grid-canvas'));
  } finally { grid.destroy(); }
});

it('keeps the button reachable at the viewport edge and hides it when its cell scrolls away', async () => {
  const { grid, button, wb, id } = await mount();
  try {
    wb.setColWidth(id, 0, 800); await flush();
    expect(button.style.transform).toBe(`translate(776px, ${A3_TOP}px)`);
    grid.viewport.scrollLeft = 1100; grid.viewport.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('offscreen')).toBe(true);
    grid.viewport.scrollLeft = 700; grid.viewport.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('offscreen')).toBe(false);
    expect(button.style.transform).toBe(`translate(800px, ${A3_TOP}px)`);
  } finally { grid.destroy(); }
});
