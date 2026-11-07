// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

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
const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));
const mod = { ctrlKey: true, metaKey: true };

async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'A rather long label');
  wb.setInput(id, 0, 2, 'Another long label here');
  wb.setInput(id, 3, 0, 'x');
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid, colClip: grid.el.querySelector('.grid-colhead-clip'), rowClip: grid.el.querySelector('.grid-rowhead-clip') };
}

// Resizing or fitting one of several selected columns applies to them all, but only the block of
// the current range was taken: columns added with Ctrl+click were left as they were.
describe('several columns or rows selected with Ctrl+click', () => {
  it('are all resized when one of them is dragged', async () => {
    const { wb, id, grid, colClip } = await mount();
    pointer(colClip.querySelector('.hcell[data-c="0"]'), 'pointerdown', { clientX: 98, clientY: 10 });
    pointer(colClip, 'pointerup', { clientX: 98, clientY: 10 });
    pointer(colClip.querySelector('.hcell[data-c="2"]'), 'pointerdown', { clientX: 298, clientY: 10, ...mod });
    pointer(colClip, 'pointerup', { clientX: 298, clientY: 10, ...mod });
    expect(grid.ranges.length).toBe(2);
    pointer(colClip.querySelector('.col-resizer[data-c="2"]'), 'pointerdown', { clientX: 348, clientY: 10 });
    pointer(colClip, 'pointermove', { clientX: 388, clientY: 10 });
    pointer(colClip, 'pointerup', { clientX: 388, clientY: 10 });
    expect([0, 1, 2].map((c) => wb.colWidth(id, c))).toEqual([140, 100, 140]);
    expect(wb.undoLabel()).toBe('Resize columns'); // as one step
    grid.destroy();
  });

  it('are all fitted when one of their edges is double-clicked', async () => {
    const { wb, id, colClip, grid } = await mount();
    pointer(colClip.querySelector('.hcell[data-c="0"]'), 'pointerdown', { clientX: 98, clientY: 10 });
    pointer(colClip, 'pointerup', { clientX: 98, clientY: 10 });
    pointer(colClip.querySelector('.hcell[data-c="2"]'), 'pointerdown', { clientX: 298, clientY: 10, ...mod });
    pointer(colClip, 'pointerup', { clientX: 298, clientY: 10, ...mod });
    colClip.querySelector('.col-resizer[data-c="0"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect([0, 1, 2].map((c) => wb.colWidth(id, c))).toEqual([19 * 7 + 14, 100, 23 * 7 + 14]);
    grid.destroy();
  });

  it('rows too, when one of them is dragged', async () => {
    const { wb, id, rowClip, grid } = await mount();
    pointer(rowClip.querySelector('.hcell[data-r="0"]'), 'pointerdown', { clientX: 20, clientY: 39 });
    pointer(rowClip, 'pointerup', { clientX: 20, clientY: 39 });
    pointer(rowClip.querySelector('.hcell[data-r="3"]'), 'pointerdown', { clientX: 20, clientY: 117, ...mod });
    pointer(rowClip, 'pointerup', { clientX: 20, clientY: 117, ...mod });
    pointer(rowClip.querySelector('.row-resizer[data-r="3"]'), 'pointerdown', { clientX: 20, clientY: 130 });
    pointer(rowClip, 'pointermove', { clientX: 20, clientY: 140 });
    pointer(rowClip, 'pointerup', { clientX: 20, clientY: 140 });
    expect([0, 1, 2, 3].map((r) => wb.rowHeight(id, r))).toEqual([Math.round(DEFAULT_ROW_HEIGHT) + 10, DEFAULT_ROW_HEIGHT, DEFAULT_ROW_HEIGHT, Math.round(DEFAULT_ROW_HEIGHT) + 10]);
    grid.destroy();
  });
});
