// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
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

const flush = () => new Promise((r) => setTimeout(r, 5));
const LONG = 'x'.repeat(32); // 224px of text in a 100px column: over two neighbours
const THICK = { color: '#ff0000', style: 'thick' };
const SIDES = ['bt', 'bl', 'bb', 'br'];

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(12, 0));
  await flush();
  const node = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
  const sides = (n) => SIDES.filter((cls) => n.classList.contains(cls));
  return { wb, id, grid, node, sides, prop: (r, c, name) => node(r, c).style.getPropertyValue(name) };
}

// A label's node grew to cover the cells its text ran over, and its borders went with it: an
// outlined A1 whose text ran into B1 and C1 drew its red box around A1:C1, underlining the blank
// cells. Only the text runs over now; the borders stay on the cell.
describe('the borders of a label whose text overflows', () => {
  it('stay around its own cell while the text runs on to the right', async () => {
    const { node, sides, prop } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, LONG);
      wb.applyBorders(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'outer', THICK);
    });
    const label = node(0, 0);
    expect(label.style.width).toBe('300px');
    expect(label.classList.contains('spill')).toBe(true);
    expect(label.classList.contains('spill-bordered')).toBe(true);
    expect(sides(label)).toEqual([]); // the wide node draws no border of its own
    expect(label.style.borderRightWidth).toBe('');
    expect(label.style.borderBottomWidth).toBe('');
    const box = label.querySelector('.cell-border');
    expect(sides(box)).toEqual(SIDES);
    expect(box.style.borderRightWidth).toBe('3px');
    expect(box.style.borderBottomColor).toBe('rgb(255, 0, 0)');
    expect(prop(0, 0, '--spill-own-x')).toBe('0px');
    expect(prop(0, 0, '--spill-own')).toBe('100px');
    expect(label.textContent).toBe(LONG);
  });

  it('sit at the right end of the box when right-aligned text runs leftwards, beside the cell\'s own fill', async () => {
    const { node, sides, prop } = await mount((wb, id) => {
      wb.setInput(id, 2, 2, LONG);
      wb.applyStyle(id, { r1: 2, c1: 2, r2: 2, c2: 2 }, { align: 'right', bg: '#ffff00' });
      wb.applyBorders(id, { r1: 2, c1: 2, r2: 2, c2: 2 }, 'outer', THICK);
    });
    const label = node(2, 2);
    expect(label.style.left).toBe('0px');
    expect(label.style.width).toBe('300px');
    expect(label.classList.contains('spill-over-fill')).toBe(true);
    expect(label.classList.contains('spill-bordered')).toBe(true);
    expect(sides(label.querySelector('.cell-border'))).toEqual(SIDES);
    expect(prop(2, 2, '--spill-own-x')).toBe('200px');
    expect(prop(2, 2, '--spill-own')).toBe('100px');
    expect(prop(2, 2, '--spill-bg')).toBe('rgb(255, 255, 0)');
  });

  it('leave a bordered label that fits, and an unbordered one that overflows, as they were', async () => {
    const { node, sides } = await mount((wb, id) => {
      wb.setInput(id, 4, 1, 'short');
      wb.applyBorders(id, { r1: 4, c1: 1, r2: 4, c2: 1 }, 'outer', THICK);
      wb.setInput(id, 6, 0, LONG);
    });
    expect(sides(node(4, 1))).toEqual(SIDES);
    expect(node(4, 1).querySelector('.cell-border')).toBeNull();
    expect(node(4, 1).classList.contains('spill-bordered')).toBe(false);
    expect(node(6, 0).classList.contains('spill')).toBe(true);
    expect(node(6, 0).classList.contains('spill-bordered')).toBe(false);
    expect(node(6, 0).querySelector('.cell-border')).toBeNull();
  });

  it('are drawn on that box by the stylesheet, the wide node left borderless and painting the grid lines', () => {
    const css = stylesheet('grid.css');
    const wide = declared(css, '.cell.spill.spill-bordered', false);
    expect(wide['border-right']).toBe('0');
    expect(wide['border-bottom']).toBe('0');
    expect(wide.background).toContain('var(--spill-lines)');
    expect(wide['--spill-lines']).toContain('var(--grid-line)');
    const filled = declared(css, '.cell.spill.spill-over-fill.spill-bordered', false).background;
    expect(filled.indexOf('--spill-bg')).toBeLessThan(filled.indexOf('--spill-lines')); // a fill covers gridlines; the separate border box still draws explicit borders
    expect(declared(css, '.grid.no-gridlines .cell.spill.spill-bordered', false)['--spill-line']).toBe('transparent');
    const box = declared(css, '.cell-border', false);
    expect(box.left).toBe('var(--spill-own-x, 0)');
    expect(box.width).toBe('var(--spill-own)');
    expect(box['pointer-events']).toBe('none');
    for (const [cls, side] of [['bt', 'top'], ['bl', 'left'], ['bb', 'bottom'], ['br', 'right']]) {
      expect(declared(css, `.cell-border.${cls}`, false)[`border-${side}`]).toBe('1px solid var(--ink)');
    }
  });
});
