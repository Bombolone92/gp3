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

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'keep me');
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, onCommand: (c) => commands.push(c) });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  return { wb, id, grid, commands };
}

const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init }));
const key = (target, key, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

describe('dragging across the headers', () => {
  it('scrolls only along the columns when selecting columns, and only along the rows for rows', () => {
    const { grid } = setup();
    const viewport = grid.el.querySelector('.grid-viewport');
    viewport.getBoundingClientRect = () => ({ left: 40, top: 60, right: 840, bottom: 460, width: 800, height: 400 });
    const scrolls = [];
    viewport.scrollBy = (dx, dy) => scrolls.push([dx, dy]);
    const colClip = grid.el.querySelector('.grid-colhead-clip');
    const headB = colClip.querySelector('.hcell[data-c="1"]');
    expect(headB).toBeTruthy();
    pointer(headB, 'pointerdown', { clientX: 200, clientY: 30 });
    // The pointer sits in the header strip above the viewport, well inside its horizontal extent.
    pointer(colClip, 'pointermove', { clientX: 260, clientY: 30 });
    vi.advanceTimersByTime(160);
    expect(scrolls).toEqual([]);
    // Past the right edge the sheet does scroll sideways, and the selection keeps following.
    pointer(colClip, 'pointermove', { clientX: 900, clientY: 30 });
    vi.advanceTimersByTime(160);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every(([, dy]) => dy === 0)).toBe(true);
    pointer(colClip, 'pointerup', { clientX: 900, clientY: 30 });

    scrolls.length = 0;
    const rowClip = grid.el.querySelector('.grid-rowhead-clip') || grid.el.querySelector('[class*="rowhead"]');
    const head3 = grid.el.querySelector('.hcell[data-r="2"]');
    pointer(head3, 'pointerdown', { clientX: 20, clientY: 150 });
    pointer(rowClip, 'pointermove', { clientX: 20, clientY: 200 });
    vi.advanceTimersByTime(160);
    expect(scrolls).toEqual([]);
    pointer(rowClip, 'pointermove', { clientX: 20, clientY: 500 });
    vi.advanceTimersByTime(160);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls.every(([dx]) => dx === 0)).toBe(true);
  });
});

describe('modifier chords on the grid', () => {
  it('never start typing into the cell, while AltGr characters still do', () => {
    const { grid, wb, id } = setup();
    const viewport = grid.el.querySelector('.grid-viewport');
    // The other platform's shortcut modifier is not a shortcut here, but it is not a letter either.
    for (const init of [{ metaKey: true }, { ctrlKey: true, altKey: true }, { altKey: true }]) {
      const e = key(viewport, 'b', init);
      expect(grid.editing, JSON.stringify(init)).toBe(false);
      void e;
    }
    expect(wb.getValue(id, 0, 0)).toBe('keep me');
    key(viewport, '@', { ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(grid.editing).toBe(true);
    expect(grid.el.querySelector('.grid-editor').value).toBe('@');
  });
});

describe('dragging the fill handle past the edge', () => {
  // Auto-scroll used to move only a plain selection; a fill or move preview stayed where the
  // pointer left the viewport while the sheet scrolled on underneath it.
  it('keeps the fill preview following the pointer while the sheet auto-scrolls', () => {
    const { grid } = setup();
    const viewport = grid.el.querySelector('.grid-viewport');
    viewport.getBoundingClientRect = () => ({ left: 40, top: 60, right: 840, bottom: 460, width: 800, height: 400 });
    let scrollLeft = 0;
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v) => { scrollLeft = v; } });
    viewport.scrollBy = (dx) => { scrollLeft += dx; };
    const handle = grid.el.querySelector('.fill-handle');
    pointer(handle, 'pointerdown', { clientX: 140, clientY: 80 });
    pointer(viewport, 'pointermove', { clientX: 900, clientY: 80 });
    vi.runOnlyPendingTimers();
    const preview = grid.el.querySelector('.fill-preview');
    expect(preview.hidden).toBe(false);
    const before = parseFloat(preview.style.width);
    vi.advanceTimersByTime(260); // several auto-scroll ticks
    vi.runOnlyPendingTimers();
    expect(scrollLeft).toBeGreaterThan(0);
    expect(parseFloat(preview.style.width)).toBeGreaterThan(before);
    pointer(viewport, 'pointerup', { clientX: 900, clientY: 80 });
  });
});
