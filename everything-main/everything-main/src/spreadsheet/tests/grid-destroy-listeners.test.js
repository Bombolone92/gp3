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

describe('a destroyed grid', () => {
  it('no longer grows the sheet on scroll or zooms on Ctrl+wheel', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const zooms = [];
    const grid = createGrid({ wb, sheetId: id, onZoom: (z) => zooms.push(z) });
    document.body.replaceChildren(grid.el);
    await flush();
    const { viewport } = grid;
    const rows = wb.sheet(id).rows;
    grid.destroy();
    viewport.scrollTop = 100000;
    viewport.dispatchEvent(new Event('scroll'));
    expect(wb.sheet(id).rows).toBe(rows);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(zooms).toEqual([]);
    expect(grid.zoom).toBe(1);
  });
});
