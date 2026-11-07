// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid, COL_HEADER_H } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { stylesheet, declared } from './helpers/css.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const flush = () => new Promise((r) => setTimeout(r, 5));

/** One frozen column; the row headers are 48px wide and the column headers COL_HEADER_H (26px) tall. */
async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setFrozen(id, 0, 1);
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  const scroll = { left: 0, top: 0 };
  Object.defineProperty(grid.viewport, 'scrollLeft', { configurable: true, get: () => scroll.left, set: (v) => { scroll.left = v; } });
  Object.defineProperty(grid.viewport, 'scrollTop', { configurable: true, get: () => scroll.top, set: (v) => { scroll.top = v; } });
  await flush();
  const scrollTo = (left, top) => { scroll.left = left; scroll.top = top; grid.viewport.dispatchEvent(new Event('scroll')); };
  return { wb, id, grid, scrollTo };
}

// The popovers beside the active cell lived in the scrolling canvas, and for a frozen cell were moved or
// copied into the frozen pane's clipped layer: a link popover wider than the frozen column lost its
// buttons, and a note was cut off as soon as the sheet scrolled.
describe('the popovers of a frozen cell', () => {
  it('are hosted by the grid outside the pane, at the cell on screen, and follow a scroll at once', async () => {
    const { grid, scrollTo } = await mount((wb, id) => { wb.setInput(id, 3, 0, 'https://example.com/reports/2026/quarterly-summary.html'); });
    grid.setSelection(S.single(3, 0));
    await flush();
    const pop = grid.el.querySelector('.link-pop');
    expect(pop.hidden).toBe(false);
    expect(pop.parentNode).toBe(grid.el);
    const underA4 = COL_HEADER_H + 3 * ROW + ROW + 4; // headers, rows 1-3, A4 itself, a 4px gap
    expect(pop.style.transform).toBe(`translate(48px, ${underA4}px)`);
    scrollTo(0, 30); // the frozen column scrolls vertically: the popover moves before the next frame is drawn
    expect(pop.style.transform).toBe(`translate(48px, ${underA4 - 30}px)`);
    scrollTo(250, 30); // but not horizontally
    expect(pop.style.transform).toBe(`translate(48px, ${underA4 - 30}px)`);
    grid.destroy();
  });

  it('go out of sight with their cell instead of standing over the headers', async () => {
    const { grid, scrollTo } = await mount((wb, id) => { wb.setNote(id, 2, 0, 'A note on A3'); });
    grid.setSelection(S.single(2, 0));
    await flush();
    const pop = grid.el.querySelector('.note-pop');
    expect(pop.hidden).toBe(false);
    expect(pop.parentNode).toBe(grid.el);
    const besideA3 = COL_HEADER_H + 2 * ROW; // beside A3: x is 48 + 100 + 6, y the headers and rows 1-2
    expect(pop.style.transform).toBe(`translate(154px, ${besideA3}px)`);
    scrollTo(60, 0);
    expect(pop.style.transform).toBe(`translate(154px, ${besideA3}px)`);
    scrollTo(60, 300); // A3 has scrolled off the top
    expect(pop.classList.contains('offscreen')).toBe(true);
    scrollTo(60, ROW); // one row scrolled away: A3 is in sight again, one row below the headers
    expect(pop.classList.contains('offscreen')).toBe(false);
    expect(pop.style.transform).toBe(`translate(154px, ${besideA3 - ROW}px)`);
    expect(grid.el.querySelectorAll('.note-pop').length).toBe(1); // no copy left in the pane
    grid.destroy();
  });

  it('of a cell outside the panes stay in the canvas and scroll with it', async () => {
    const { grid } = await mount((wb, id) => { wb.setNote(id, 2, 2, 'A note on C3'); });
    grid.setSelection(S.single(2, 2));
    await flush();
    const pop = grid.el.querySelector('.note-pop');
    expect(pop.parentNode).toBe(grid.el.querySelector('.grid-canvas'));
    expect(pop.style.transform).toBe(`translate(306px, ${2 * ROW}px)`); // canvas coordinates: beside C3, below rows 1-2
    grid.destroy();
  });

  it('paint over the panes, while everything in the scrolling canvas stays under them', () => {
    const css = stylesheet('grid.css');
    const z = (selector) => Number(declared(css, selector, false)['z-index']);
    expect(z('.grid-viewport')).toBeGreaterThanOrEqual(0); // a stacking context of its own
    expect(z('.grid-viewport')).toBeLessThan(z('.frz-layer'));
    for (const pop of ['.note-pop', '.prompt-pop', '.link-pop']) {
      expect(z(pop), pop).toBeGreaterThan(z('.frz-corner'));
      expect(declared(css, `${pop}.offscreen`, false).visibility, pop).toBe('hidden');
    }
  });
});
