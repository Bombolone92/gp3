// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

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
const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));

describe('Ctrl+click on a header inside a whole-column selection', () => {
  it('keeps the columns selected instead of collapsing to the clicked one', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    grid.selectByName('A:C');
    const clip = grid.el.querySelector('.grid-colhead-clip');
    const head = clip.querySelector('.hcell[data-c="1"]');
    pointer(head, 'pointerdown', { clientX: 150, clientY: 10, ctrlKey: true, metaKey: true });
    pointer(clip, 'pointerup', { clientX: 150, clientY: 10, ctrlKey: true, metaKey: true });
    const covered = new Set();
    for (const rg of grid.ranges) for (let c = rg.c1; c <= rg.c2; c++) covered.add(c);
    expect([...covered].sort()).toEqual([0, 1, 2]);
    expect(wb.canUndo()).toBe(false); // nothing was reordered
    // A plain click on a header inside the selection still selects just that column.
    pointer(head, 'pointerdown', { clientX: 150, clientY: 10 });
    pointer(clip, 'pointerup', { clientX: 150, clientY: 10 });
    expect(grid.ranges).toEqual([{ r1: 0, c1: 1, r2: 1048575, c2: 1 }]);
    grid.destroy();
  });
});
