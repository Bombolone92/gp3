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
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));

describe('dragging the fill handle', () => {
  it('gives the grid the keyboard focus, like every other press on the cells', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '1');
    const grid = createGrid({ wb, sheetId: id });
    const button = document.createElement('button');
    document.body.replaceChildren(grid.el, button);
    await flush();
    button.focus();
    expect(document.activeElement).toBe(button);
    pointer(grid.el.querySelector('.fill-handle'), 'pointerdown', 99, 25);
    expect(document.activeElement).toBe(grid.viewport);
    pointer(grid.viewport, 'pointermove', 50, 65);
    pointer(grid.viewport, 'pointerup', 50, 65);
    expect(wb.getValue(id, 2, 0)).toBe(1);
    expect(document.activeElement).toBe(grid.viewport);
    grid.destroy();
  });
});
