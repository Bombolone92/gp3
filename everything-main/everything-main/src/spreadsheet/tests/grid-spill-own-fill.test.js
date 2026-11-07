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
const LONG = 'A long label that runs on'; // 175px of text in a 100px column

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(12, 0));
  await flush();
  const node = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
  return { wb, id, grid, node, prop: (r, c, name) => node(r, c).style.getPropertyValue(name) };
}

// A filled label's node grew to cover the cells its text ran over, taking its fill colour with it:
// the blank neighbour looked filled. Only the text overflows now; the fill stays in its cell.
describe('the fill of a label whose text overflows', () => {
  it('stays in its own cell while the text runs on over an unpainted neighbour', async () => {
    const { node, prop } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, LONG);
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: '#ffff00' });
    });
    const label = node(0, 0);
    expect(label.style.width).toBe('200px');
    expect(label.classList.contains('spill-over-fill')).toBe(true);
    expect(label.style.backgroundColor).toBe(''); // the fill is drawn as a layer sized to the cell
    expect(prop(0, 0, '--spill-bg')).toBe('rgb(255, 255, 0)');
    expect(prop(0, 0, '--spill-own-x')).toBe('0px');
    expect(prop(0, 0, '--spill-own')).toBe('100px');
    expect(prop(0, 0, '--spill-back-x')).toBe('0px'); // the surface backing that hides the grid lines runs the whole way
    expect(prop(0, 0, '--spill-opaque')).toBe('200px');
  });

  it('sits at the right end of the box when right-aligned text runs leftwards', async () => {
    const { node, prop } = await mount((wb, id) => {
      wb.setInput(id, 2, 2, LONG);
      wb.applyStyle(id, { r1: 2, c1: 2, r2: 2, c2: 2 }, { bg: '#ff0000', align: 'right' });
    });
    expect(node(2, 2).style.left).toBe('100px');
    expect(node(2, 2).style.width).toBe('200px');
    expect(prop(2, 2, '--spill-own-x')).toBe('100px');
    expect(prop(2, 2, '--spill-own')).toBe('100px');
    expect(prop(2, 2, '--spill-opaque')).toBe('200px');
  });

  it('treats a fill a rule paints the same way', async () => {
    const { node, prop } = await mount((wb, id) => {
      wb.setInput(id, 4, 0, LONG);
      wb.addRule(id, { range: { r1: 4, c1: 0, r2: 4, c2: 0 }, type: 'notEmpty', style: { bg: '#00ccff' } });
    });
    expect(node(4, 0).style.backgroundColor).toBe('');
    expect(prop(4, 0, '--spill-bg')).toBe('rgb(0, 204, 255)');
    expect(prop(4, 0, '--spill-own')).toBe('100px');
  });

  it('is drawn as its own layer over the surface backing by the stylesheet', () => {
    const css = stylesheet('grid.css');
    const background = declared(css, '.cell.spill.spill-over-fill', false).background;
    expect(background).toContain('var(--spill-own-x');
    expect(background).toContain('var(--spill-own');
    expect(background).toContain('var(--spill-back-x');
    expect(background.indexOf('--spill-bg')).toBeLessThan(background.indexOf('--surface')); // the fill lies over the backing
  });

  it('leaves an unfilled label\'s backing as it was', async () => {
    const { node, prop } = await mount((wb, id) => { wb.setInput(id, 6, 0, LONG); });
    expect(node(6, 0).classList.contains('spill')).toBe(true);
    expect(node(6, 0).classList.contains('spill-over-fill')).toBe(false);
    expect(prop(6, 0, '--spill-own')).toBe('');
  });
});
