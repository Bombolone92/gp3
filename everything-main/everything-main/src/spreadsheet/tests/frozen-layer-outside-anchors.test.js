// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount(prepare, { scrollLeft = 0, scrollTop = 0 }) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  const viewport = grid.el.querySelector('.grid-viewport');
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v) => { scrollLeft = v; } });
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v) => { scrollTop = v; } });
  viewport.dispatchEvent(new Event('scroll'));
  vi.runOnlyPendingTimers();
  return { wb, id, grid };
}

// The frozen layers built only the cells inside their window, skipping covered cells, so a merge
// whose anchor had scrolled out of the buffer lost its content: the canvas drew the anchor, but
// the opaque frozen layer covered it.
describe('a frozen layer whose merge anchor has scrolled out of the buffer', () => {
  it('still draws the merged title across frozen rows', () => {
    const { grid } = mount((wb, id) => {
      wb.setFrozen(id, 1, 0);
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 4 });
      wb.setInput(id, 0, 0, 'wide title');
    }, { scrollLeft: 550 });
    const merged = grid.el.querySelector('.frz-rows .frz-cells .cell.merged');
    expect(merged).toBeTruthy();
    expect(merged.textContent).toBe('wide title');
    expect(merged.style.left).toBe('0px');
    expect(merged.style.width).toBe('500px');
    expect(merged.id).toBe(''); // the canvas owns the id
    expect(document.querySelectorAll('#gc-0-0')).toHaveLength(1);
    grid.destroy();
  });

  it('still draws a tall merge down frozen columns', () => {
    const { grid } = mount((wb, id) => {
      wb.setFrozen(id, 0, 1);
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 29, c2: 0 });
      wb.setInput(id, 0, 0, 'tall');
    }, { scrollTop: 23 * ROW }); // row 23 at the top: the anchor is far out of the buffer, the merge still in view
    const merged = grid.el.querySelector('.frz-cols .frz-cells .cell.merged');
    expect(merged).toBeTruthy();
    expect(merged.textContent).toBe('tall');
    expect(merged.style.height).toBe(`${30 * ROW}px`);
    expect(merged.parentElement.style.transform).toBe('translateY(0px)');
    grid.destroy();
  });

  it('still draws a label spilling into frozen rows from a column out of view', () => {
    const { grid } = mount((wb, id) => {
      wb.setFrozen(id, 1, 0);
      wb.setInput(id, 0, 0, 'A long label that runs on '.repeat(20));
    }, { scrollLeft: 550 });
    const label = grid.el.querySelector('.frz-rows .frz-cells .cell.spill');
    expect(label).toBeTruthy();
    expect(label.style.left).toBe('0px');
    expect(parseFloat(label.style.width)).toBeGreaterThan(600);
    grid.destroy();
  });
});
