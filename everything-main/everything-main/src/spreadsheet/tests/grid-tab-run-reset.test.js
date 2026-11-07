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
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, viewport: grid.viewport };
}

// Enter after a run of Tabs returns to the column where the run began; anything else that moves
// the active cell ends the run, so Enter then simply goes down from where the user is.
describe('a run of Tabs', () => {
  it('ends when another cell is clicked, even on the same row', async () => {
    const { grid, viewport } = setup();
    await flush();
    grid.setSelection(S.single(0, 0));
    key(viewport, 'Tab');
    pointer(viewport, 'pointerdown', 350, 13); // D1
    pointer(viewport, 'pointerup', 350, 13);
    expect(grid.active).toEqual({ r: 0, c: 3 });
    key(viewport, 'Enter');
    expect(grid.active).toEqual({ r: 1, c: 3 });
    grid.destroy();
  });

  it('ends when an arrow key moves the active cell', async () => {
    const { grid, viewport } = setup();
    await flush();
    grid.setSelection(S.single(4, 0));
    key(viewport, 'Tab');
    key(viewport, 'ArrowRight');
    key(viewport, 'Enter');
    expect(grid.active).toEqual({ r: 5, c: 2 });
    grid.destroy();
  });

  it('still brings Enter back to its origin, with Shift+Tab as part of the run', async () => {
    const { grid, viewport } = setup();
    await flush();
    grid.setSelection(S.single(7, 0));
    key(viewport, 'Tab');
    key(viewport, 'Tab');
    key(viewport, 'Enter');
    expect(grid.active).toEqual({ r: 8, c: 0 });
    grid.setSelection(S.single(10, 1));
    key(viewport, 'Tab');
    key(viewport, 'Tab');
    key(viewport, 'Tab', { shiftKey: true });
    expect(grid.active).toEqual({ r: 10, c: 2 });
    key(viewport, 'Enter');
    expect(grid.active).toEqual({ r: 11, c: 1 });
    grid.destroy();
  });
});
