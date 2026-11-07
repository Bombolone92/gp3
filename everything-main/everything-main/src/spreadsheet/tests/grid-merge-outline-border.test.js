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

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.mergeCells(id, { r1: 1, c1: 1, r2: 2, c2: 2 }); // B2:C3
  wb.setInput(id, 1, 1, 'Merged');
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  const node = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
  return { wb, id, grid, node, classes: (r, c) => ['bt', 'bl', 'bb', 'br'].filter((k) => node(r, c).classList.contains(k)) };
}

// An outline on a merged range is stored on the range's edge cells, and the grid built only the
// anchor, reading the anchor's own flags: the bottom and right sides of the block never showed,
// and a neighbour below yielded its top border to a covered cell nobody drew, so no line at all
// separated the block from the row under it.
describe('an outline border on a merged block', () => {
  it('draws all four sides on the anchor, in the outline\'s colour and weight', async () => {
    const { node, classes } = await mount((wb, id) => { wb.applyBorders(id, { r1: 1, c1: 1, r2: 2, c2: 2 }, 'outer', { color: '#ff0000', style: 'thick' }); });
    expect(classes(1, 1)).toEqual(['bt', 'bl', 'bb', 'br']);
    const anchor = node(1, 1);
    expect(anchor.style.borderBottomWidth).toBe('3px');
    expect(anchor.style.borderBottomColor).toBe('rgb(255, 0, 0)');
    expect(anchor.style.borderRightWidth).toBe('3px');
    expect(anchor.style.borderRightColor).toBe('rgb(255, 0, 0)');
    expect(anchor.style.borderTopWidth).toBe('3px');
    expect(anchor.style.borderLeftWidth).toBe('3px');
  });

  it('draws only the bottom side when the range was given one', async () => {
    const { node, classes } = await mount((wb, id) => { wb.applyBorders(id, { r1: 1, c1: 1, r2: 2, c2: 2 }, 'bottom', { style: 'medium' }); });
    expect(classes(1, 1)).toEqual(['bb']);
    expect(node(1, 1).style.borderBottomWidth).toBe('2px');
    expect(node(1, 1).style.borderRightWidth).toBe('');
  });

  it('draws the far edges of an empty merged range, whose anchor holds nothing at all', async () => {
    const { node, classes } = await mount((wb, id) => {
      wb.setInput(id, 1, 1, '');
      wb.applyBorders(id, { r1: 1, c1: 1, r2: 2, c2: 2 }, 'bottom', { color: '#0000ff' });
    });
    expect(classes(1, 1)).toEqual(['bb']);
    expect(node(1, 1).style.borderBottomColor).toBe('rgb(0, 0, 255)');
  });

  it('resolves equal shared edges in favor of the neighbor below or to the right', async () => {
    const { classes } = await mount((wb, id) => {
      wb.applyBorders(id, { r1: 1, c1: 1, r2: 2, c2: 2 }, 'outer');
      wb.setInput(id, 3, 1, 'below');
      wb.applyStyle(id, { r1: 3, c1: 1, r2: 3, c2: 1 }, { bt: true });
      wb.setInput(id, 1, 3, 'beside');
      wb.applyStyle(id, { r1: 1, c1: 3, r2: 1, c2: 3 }, { bl: true });
    });
    expect(classes(3, 1)).toEqual(['bt']);
    expect(classes(1, 3)).toEqual(['bl']);
  });

  it('leaves a neighbour its own border when the block draws none on that side', async () => {
    const { classes } = await mount((wb, id) => {
      wb.setInput(id, 3, 1, 'below');
      wb.applyStyle(id, { r1: 3, c1: 1, r2: 3, c2: 1 }, { bt: true });
      wb.setInput(id, 1, 3, 'beside');
      wb.applyStyle(id, { r1: 1, c1: 3, r2: 1, c2: 3 }, { bl: true });
    });
    expect(classes(1, 1)).toEqual([]);
    expect(classes(3, 1)).toEqual(['bt']);
    expect(classes(1, 3)).toEqual(['bl']);
  });
});
