// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

const touch = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' }));
const contextmenu = (target, x, y) => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));

function setup() {
  const wb = new Workbook();
  const menus = [];
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, onContextMenu: (m) => menus.push(m) });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  return { grid, menus, viewport: grid.viewport };
}

// A long press on Android opens the cell menu from the grid's own timer and again from the
// browser's contextmenu event for the same press; only one menu must open, whichever comes first.
describe('a long press on a cell', () => {
  it('opens the menu once when the browser reports its own contextmenu after the press timer', () => {
    const { grid, menus, viewport } = setup();
    touch(viewport, 'pointerdown', 50, 13);
    vi.advanceTimersByTime(500);
    expect(menus).toHaveLength(1);
    contextmenu(viewport, 50, 13);
    touch(viewport, 'pointerup', 50, 13);
    expect(menus).toHaveLength(1);
    // A later right-click is a new request.
    vi.advanceTimersByTime(2000);
    contextmenu(viewport, 50, 13);
    expect(menus).toHaveLength(2);
    grid.destroy();
  });

  it('opens the menu once when the browser reports contextmenu before the press timer', () => {
    const { grid, menus, viewport } = setup();
    touch(viewport, 'pointerdown', 50, 13);
    vi.advanceTimersByTime(300);
    contextmenu(viewport, 50, 13);
    expect(menus).toHaveLength(1);
    vi.advanceTimersByTime(500);
    touch(viewport, 'pointerup', 50, 13);
    expect(menus).toHaveLength(1);
    expect(grid.active).toEqual({ r: 0, c: 0 });
    grid.destroy();
  });
});
