// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount() {
  const wb = new Workbook();
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const wheel = (deltaY, init = {}) => grid.viewport.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, bubbles: true, cancelable: true, ...init }));
  return { grid, wheel };
}

// Every Ctrl+wheel event stepped the zoom 10% whatever its size, so a light trackpad pinch,
// which arrives as dozens of tiny events, slammed into the zoom limits.
describe('pinch and Ctrl+wheel zoom', () => {
  it('steps once per notch of a mouse wheel', () => {
    const { grid, wheel } = mount();
    wheel(-100);
    expect(grid.zoom).toBeCloseTo(1.1);
    wheel(-120); // a Windows notch
    expect(grid.zoom).toBeCloseTo(1.2);
    wheel(100);
    expect(grid.zoom).toBeCloseTo(1.1);
  });

  it('gathers the small events of a pinch into steps', () => {
    const { grid, wheel } = mount();
    for (let i = 0; i < 6; i++) wheel(-5);
    expect(grid.zoom).toBe(1);
    for (let i = 0; i < 3; i++) wheel(-5);
    expect(grid.zoom).toBeCloseTo(1.1);
    for (let i = 0; i < 6; i++) wheel(-5);
    expect(grid.zoom).toBeCloseTo(1.1);
    for (let i = 0; i < 3; i++) wheel(-5);
    expect(grid.zoom).toBeCloseTo(1.2);
    // Reversing direction starts a fresh count.
    for (let i = 0; i < 5; i++) wheel(-5);
    for (let i = 0; i < 7; i++) wheel(5);
    expect(grid.zoom).toBeCloseTo(1.2);
    wheel(5);
    expect(grid.zoom).toBeCloseTo(1.1);
  });

  it('treats a line-mode wheel notch as one step', () => {
    const { grid, wheel } = mount();
    wheel(-3, { deltaMode: 1 });
    expect(grid.zoom).toBeCloseTo(1.1);
  });
});
