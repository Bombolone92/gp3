// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

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

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const touch = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' }));

/** A1 = "Title" merged over A1:B2 (200 by 2 × ROW pixels); only its top-left 100 by ROW are the anchor's own. */
function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Title');
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, 4, 4, 'other');
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  const tap = (x, y) => { touch(grid.viewport, 'pointerdown', x, y); touch(grid.viewport, 'pointerup', x, y); };
  return { wb, id, grid, tap };
}

// A tap was compared with the active cell by the coordinates under the finger, which for most of
// a merged block are a covered cell's, never the anchor's: tapping the selected merge anywhere but
// its top-left corner re-selected it for ever and never opened it for editing.
describe('a second tap on a selected merged cell', () => {
  it('opens it for editing wherever on the block the finger lands', () => {
    const { grid, tap } = setup();
    grid.selectByName('A1');
    tap(150, 1.5 * ROW); // B2's pixels
    expect(grid.editing).toBe(true);
    expect(grid.editState.r).toBe(0);
    expect(grid.editState.c).toBe(0);
    grid.cancelEdit();
    tap(50, ROW / 2); // the anchor's own pixels, as before
    expect(grid.editing).toBe(true);
    grid.destroy();
  });

  it('first selects the merge when another cell was active, then edits it', () => {
    const { grid, tap } = setup();
    grid.selectByName('E5');
    tap(150, 1.5 * ROW); // B2's pixels
    expect(grid.editing).toBe(false);
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    tap(180, 1.25 * ROW); // elsewhere in B2
    expect(grid.editing).toBe(true);
    grid.destroy();
  });
});
