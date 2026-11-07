// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

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

const flush = () => new Promise((r) => setTimeout(r, 5));
const LONG = 'x'.repeat(32); // 224px of text in a 100px column

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(12, 0));
  await flush();
  return { wb, id, grid, node: (r, c) => grid.el.querySelector(`#gc-${r}-${c}`) };
}

// The forward scan of a label's overflow tested the next cell for emptiness before passing over a
// hidden column, so a value in a hidden column clipped the label, while the look-back that finds
// labels spilling into the view from beyond it passed over hidden columns whatever they held. The
// two now agree: a hidden column has no width and what it holds is not seen.
describe('a label overflowing past a hidden column', () => {
  it('runs on over the shown neighbours whether or not the hidden cell holds a value', async () => {
    const { wb, id, node } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, LONG);
      wb.setInput(id, 0, 1, 'hidden value');
      wb.setInput(id, 2, 0, LONG);
      wb.setHidden(id, 'col', [1], true);
    });
    expect(node(0, 0).style.width).toBe('300px'); // A1 with C1 and D1, B1 at no width
    expect(node(0, 0).classList.contains('spill')).toBe(true);
    expect(node(2, 0).style.width).toBe('300px');
    // Shown again, the filled cell stops the overflow as any filled neighbour does.
    wb.setHidden(id, 'col', [1], false);
    await flush();
    expect(node(0, 0).style.width).toBe('100px');
    expect(node(0, 0).classList.contains('spill')).toBe(false);
    expect(node(2, 0).style.width).toBe('300px');
  });

  it('is found again by the look-back when its own cell has scrolled out of view', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.ensureSize(id, 100, 60);
    wb.setInput(id, 0, 0, 'x'.repeat(300)); // 2100px of text
    wb.setInput(id, 0, 3, 'hidden value');
    wb.setHidden(id, 'col', [3], true);
    const grid = createGrid({ wb, sheetId: id, announce() {} });
    document.body.replaceChildren(grid.el);
    let left = 0;
    Object.defineProperty(grid.viewport, 'scrollLeft', { configurable: true, get: () => left, set: (v) => { left = v; } });
    grid.setSelection(S.single(12, 0));
    await flush();
    expect(grid.el.querySelector('#gc-0-0').style.width).toBe('2200px');
    left = 1200;
    grid.viewport.dispatchEvent(new Event('scroll'));
    await flush();
    const label = grid.el.querySelector('#gc-0-0');
    expect(label).toBeTruthy();
    expect(label.style.width).toBe('2200px');
    grid.destroy();
  });
});
