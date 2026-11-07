// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

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
  await flush();
  const node = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
  return { wb, id, grid, node, prop: (r, c, name) => node(r, c).style.getPropertyValue(name) };
}

// The opaque backing that hides the grid lines under a running label stopped at a neighbour with a
// fill but not at one with a border, so a box drawn around the empty cells beside a title, a rule
// line or a totals underline vanished wherever the text reached — and came back the moment the
// label was shortened. The text now runs and the borders stay.
describe('a label whose text runs over bordered neighbours', () => {
  it('stops its backing at the box drawn around them', async () => {
    const { node, prop } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, LONG);
      wb.applyBorders(id, { r1: 0, c1: 1, r2: 0, c2: 2 }, 'outer', { color: '#ff0000', style: 'thick' });
    });
    const label = node(0, 0);
    expect(label.style.width).toBe('200px'); // the text still runs over B1
    expect(label.classList.contains('spill-over-fill')).toBe(true);
    expect(prop(0, 0, '--spill-back-x')).toBe('0px');
    expect(prop(0, 0, '--spill-opaque')).toBe('100px'); // its own cell only: B1's red edges still show
    expect(node(0, 1).className).toContain('bl');
  });

  it('stops at a bare underline on the empty cells beside a title', async () => {
    const { prop } = await mount((wb, id) => {
      wb.setInput(id, 3, 0, LONG);
      wb.applyBorders(id, { r1: 3, c1: 1, r2: 3, c2: 4 }, 'bottom');
    });
    expect(prop(3, 0, '--spill-opaque')).toBe('100px');
  });

  it('stops at the border when right-aligned text runs leftwards', async () => {
    const { node, prop } = await mount((wb, id) => {
      wb.setInput(id, 5, 2, LONG);
      wb.applyStyle(id, { r1: 5, c1: 2, r2: 5, c2: 2 }, { align: 'right' });
      wb.applyBorders(id, { r1: 5, c1: 1, r2: 5, c2: 1 }, 'outer');
    });
    expect(node(5, 2).style.left).toBe('100px');
    expect(node(5, 2).style.width).toBe('200px');
    expect(prop(5, 2, '--spill-back-x')).toBe('100px');
    expect(prop(5, 2, '--spill-opaque')).toBe('100px');
  });

  it('keeps the whole backing over neighbours with nothing drawn on them', async () => {
    const { node, prop } = await mount((wb, id) => { wb.setInput(id, 7, 0, LONG); });
    expect(node(7, 0).classList.contains('spill')).toBe(true);
    expect(node(7, 0).classList.contains('spill-over-fill')).toBe(false);
    expect(prop(7, 0, '--spill-opaque')).toBe('');
  });
});
