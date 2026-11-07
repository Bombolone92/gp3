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
const pe = (target, type, x, y, init = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

/** Sheet1!C3 = "A" and Two!C3 = "B"; the sheet command switches between them, as the editor does for Alt+Up/Down and Ctrl+PgUp/PgDn. */
async function mount() {
  const wb = new Workbook();
  const one = wb.sheets[0].id;
  const two = wb.addSheet('Two').id;
  wb.setInput(one, 2, 2, 'A');
  wb.setInput(two, 2, 2, 'B');
  wb.clearHistory();
  let grid;
  const onCommand = (cmd) => { if (cmd === 'sheet') grid.setSheet(grid.sheetId === one ? two : one); };
  grid = createGrid({ wb, sheetId: one, announce() {}, onCommand });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, one, two, grid, viewport: grid.viewport };
}

// A sheet switched from the keyboard in the middle of a drag left the drag alive: the release then
// moved or filled cells on the sheet shown next, which had shown no preview of it (the Alt held for
// an Alt-drag copy is the Alt that switches sheets with Down).
describe('a drag in progress when the sheet changes', () => {
  it('ends without moving anything when the selection is dragged by its border and Alt+Right shows another sheet', async () => {
    const { wb, one, two, grid, viewport } = await mount();
    grid.selectByName('C3');
    pe(viewport, 'pointerdown', 200, 65); // C3's left edge
    key(viewport, 'ArrowRight', { altKey: true });
    expect(grid.sheetId).toBe(two);
    pe(viewport, 'pointermove', 400, 143);
    pe(viewport, 'pointerup', 400, 143);
    expect(wb.getValue(two, 2, 2)).toBe('B');
    expect(wb.getValue(two, 5, 4)).toBeNull();
    expect(wb.getValue(one, 2, 2)).toBe('A');
    expect(wb.undoLabels()).toEqual([]);
    grid.destroy();
  });

  it('ends without filling anything when the fill handle is dragged and Ctrl+PgDn shows another sheet', async () => {
    const { wb, two, grid, viewport } = await mount();
    wb.setInput(two, 3, 2, 'keep');
    wb.clearHistory();
    grid.selectByName('C3');
    await flush();
    pe(grid.el.querySelector('.fill-handle'), 'pointerdown', 299, 77);
    key(viewport, 'PageDown', { ctrlKey: true, metaKey: true });
    expect(grid.sheetId).toBe(two);
    pe(viewport, 'pointermove', 250, 143);
    pe(viewport, 'pointerup', 250, 143);
    expect(wb.getValue(two, 3, 2)).toBe('keep');
    expect(wb.getValue(two, 5, 2)).toBeNull();
    expect(wb.undoLabels()).toEqual([]);
    grid.destroy();
  });

  it('ends a chart drag, a header drag and a long press the same way', async () => {
    const { wb, one, two, grid, viewport } = await mount();
    const chartId = wb.addChart(one, { type: 'text', text: 'note', anchor: { r: 1, c: 4 } });
    wb.clearHistory();
    await flush();
    const box = grid.el.querySelector('.chart-box');
    pe(box, 'pointerdown', 420, 40);
    grid.setSheet(two);
    pe(box, 'pointermove', 520, 140);
    pe(box, 'pointerup', 520, 140);
    expect(wb.chartById(one, chartId).anchor).toEqual({ r: 1, c: 4 });
    expect(wb.undoLabels()).toEqual([]);
    // A row reorder drag: rows 1..2 selected, their header pressed, the sheet switched, the pointer released on row 6.
    grid.setSheet(one);
    grid.selectByName('1:2');
    const rowClip = grid.el.querySelector('.grid-rowhead-clip');
    const hcell = rowClip.querySelector('.hcell[data-r="0"]');
    pe(hcell, 'pointerdown', 20, 13);
    grid.setSheet(two);
    pe(rowClip, 'pointermove', 20, 150);
    pe(rowClip, 'pointerup', 20, 150);
    expect(wb.getValue(two, 2, 2)).toBe('B');
    expect(wb.undoLabels()).toEqual([]);
    // A touch pressed on a cell, the sheet switched under it: the release neither selects nor edits there.
    grid.setSheet(one);
    grid.selectByName('C3');
    pe(viewport, 'pointerdown', 250, 65, { pointerType: 'touch' });
    grid.setSheet(two);
    pe(viewport, 'pointerup', 250, 65, { pointerType: 'touch' });
    expect(grid.editing).toBe(false);
    expect(grid.active).toEqual({ r: 0, c: 0 });
    grid.destroy();
  });

  it('is given up when the grid is destroyed, so a release reaching the old viewport moves nothing', async () => {
    const { wb, one, grid, viewport } = await mount();
    grid.selectByName('C3');
    pe(viewport, 'pointerdown', 200, 65);
    grid.destroy();
    pe(viewport, 'pointermove', 400, 143);
    pe(viewport, 'pointerup', 400, 143);
    expect(wb.getValue(one, 2, 2)).toBe('A');
    expect(wb.getValue(one, 5, 4)).toBeNull();
    expect(wb.undoLabels()).toEqual([]);
  });
});
