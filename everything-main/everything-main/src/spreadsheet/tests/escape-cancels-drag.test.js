// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollBy = function scrollBy() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Name');
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, onCommand: (c) => commands.push(c) });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  const pe = (type, x, y) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, button: 0, pointerType: 'mouse' }));
  const escape = () => viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  grid.setSelection(S.single(0, 0));
  vi.runOnlyPendingTimers();
  return { wb, id, grid, pe, escape, commands };
}

// Escape during a drag only collapsed the selection; the fill or move still applied on release.
describe('Escape during a drag', () => {
  it('cancels a fill so releasing fills nothing', () => {
    const { wb, id, grid, pe, escape } = mount();
    pe('pointerdown', 98, 24); // A1's fill handle
    pe('pointermove', 50, 120);
    vi.runOnlyPendingTimers();
    const preview = grid.el.querySelector('.fill-preview');
    expect(preview.hidden).toBe(false);
    escape();
    vi.runOnlyPendingTimers();
    expect(preview.hidden).toBe(true);
    pe('pointermove', 50, 150);
    pe('pointerup', 50, 150);
    expect([1, 2, 3, 4, 5].map((r) => wb.getValue(id, r, 0))).toEqual([null, null, null, null, null]);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it('cancels a move so releasing moves nothing', () => {
    const { wb, id, grid, pe, escape } = mount();
    pe('pointerdown', 1, 13); // A1's left border
    pe('pointermove', 201, 13);
    vi.runOnlyPendingTimers();
    const preview = grid.el.querySelector('.move-preview');
    expect(preview.hidden).toBe(false);
    escape();
    vi.runOnlyPendingTimers();
    expect(preview.hidden).toBe(true);
    pe('pointerup', 201, 13);
    expect(wb.getValue(id, 0, 0)).toBe('Name');
    expect(wb.getValue(id, 0, 2)).toBeNull();
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  // A freeze-bar drag keeps its own handle rather than the one Escape looked at, and the bar never
  // gave the grid the focus: Escape did nothing, silently, and the release froze the lines anyway.
  it.each([['v', 'col-resize'], ['h', 'row-resize']])('cancels a %s freeze-bar drag so releasing freezes nothing', (axis) => {
    const { grid, escape, commands } = mount();
    const bar = grid.el.querySelector(`.freeze-bar.${axis}`);
    const guide = grid.el.querySelector('.resize-guide');
    const bpe = (type, x, y) => bar.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 5, button: 0, pointerType: 'mouse' }));
    bpe('pointerdown', 250, 110);
    expect(document.activeElement).toBe(grid.viewport); // so Escape reaches the grid's own handler
    bpe('pointermove', 250, 110);
    expect(guide.hidden).toBe(false);
    expect(bar.classList.contains('dragging')).toBe(true);
    escape();
    vi.runOnlyPendingTimers();
    expect(guide.hidden).toBe(true);
    expect(bar.classList.contains('dragging')).toBe(false);
    bpe('pointerup', 250, 110);
    expect(commands).not.toContain('freeze');
    expect(grid.frozen).toEqual({ rows: 0, cols: 0 });
  });

  it('still freezes on a release without Escape', () => {
    const { grid, commands } = mount();
    const bar = grid.el.querySelector('.freeze-bar.v');
    const bpe = (type, x) => bar.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, pointerId: 5, button: 0, pointerType: 'mouse' }));
    bpe('pointerdown', 250);
    bpe('pointermove', 250);
    bpe('pointerup', 250);
    expect(commands).toContain('freeze');
  });
});
