// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const flush = () => new Promise((r) => setTimeout(r, 5));

async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Name');
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (c) => commands.push(c) });
  document.body.replaceChildren(grid.el);
  await flush();
  const escape = (target = grid.viewport) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return { wb, id, grid, commands, escape };
}

// Escape dismisses the marching ants, the format painter and a trace of precedents — and collapsed
// the selection to its active cell on the way, so the block just copied had to be selected again
// before it could be copied or formatted once more. Escape is not a selection
// command; only the ranges added with Ctrl/Cmd+click go.
describe('Escape on the grid', () => {
  it('leaves a multi-cell selection where it is, and still asks for the marquee to be cleared', async () => {
    const { grid, commands, escape } = await mount();
    grid.setRanges([{ r1: 0, c1: 0, r2: 19, c2: 3 }]);
    escape();
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 19, c2: 3 });
    expect(grid.ranges).toHaveLength(1);
    expect(commands).toEqual(['escape']);
  });

  it('leaves a whole-column selection alone too', async () => {
    const { grid, escape } = await mount();
    grid.selectByName('B:B');
    const before = grid.range;
    escape();
    expect(grid.range).toEqual(before);
  });

  it('drops the ranges added with Ctrl/Cmd+click and keeps the current one whole', async () => {
    const { grid, escape } = await mount();
    grid.setRanges([{ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 5, c1: 2, r2: 6, c2: 3 }]);
    expect(grid.ranges).toHaveLength(2);
    escape();
    expect(grid.ranges).toEqual([{ r1: 5, c1: 2, r2: 6, c2: 3 }]);
    expect(grid.active).toEqual({ r: 5, c: 2 });
  });

  it('still cancels an in-cell edit without writing the cell', async () => {
    const { wb, id, grid, escape } = await mount();
    grid.setSelection(S.single(0, 0));
    grid.beginEdit({ text: 'typed', mode: 'type' });
    expect(grid.editing).toBe(true);
    escape(grid.el.querySelector('.grid-editor'));
    expect(grid.editing).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('Name');
  });

  it('still gives up a fill drag, and the selection it was dragged from stays', async () => {
    const { wb, id, grid, escape } = await mount();
    grid.setRanges([{ r1: 0, c1: 0, r2: 2, c2: 0 }]);
    await flush();
    const vp = grid.viewport;
    vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
    const pe = (type, x, y) => vp.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, button: 0, pointerType: 'mouse' }));
    pe('pointerdown', 100, 3 * ROW); // the fill handle at the bottom-right of A1:A3
    pe('pointermove', 100, 200);
    await flush();
    expect(grid.el.querySelector('.fill-preview').hidden).toBe(false);
    escape();
    await flush();
    expect(grid.el.querySelector('.fill-preview').hidden).toBe(true);
    pe('pointerup', 100, 200);
    await flush();
    expect(wb.getValue(id, 5, 0)).toBe(null);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
  });
});
