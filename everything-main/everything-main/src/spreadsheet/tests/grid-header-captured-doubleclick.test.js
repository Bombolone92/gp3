// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { heightForLines } from '../src/core/textfit.js';

/** The height a row fitted to one line of 13px text takes (never less than the default row). */
const ONE_LINE = heightForLines(1, 13, DEFAULT_ROW_HEIGHT);

let grid;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  Element.prototype.scrollTo = () => {};
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  grid?.destroy(); grid = null;
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete document.elementFromPoint;
});
function setup({ frozen = false } = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 100, 0, 'The longest entry below the heading');
  wb.setInput(id, 0, 1, 'Short');
  wb.setRowHeight(id, 0, 100);
  if (frozen) wb.setFrozen(id, 1, 1);
  wb.clearHistory();
  grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el);
  vi.advanceTimersByTime(1);
  return { wb, id };
}
const pointer = (target, type, axis) => target.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
  clientX: axis === 'col' ? 148 : 20, clientY: axis === 'row' ? 126 : 10,
}));
function capturedDoubleClick(axis, index = 0, frozen = false) {
  const clip = grid.el.querySelector(`.grid-${axis}head-clip`);
  const head = grid.el.querySelector(`.grid-${axis}head${frozen ? '-frozen' : ''}`);
  const selector = `.${axis}-resizer[data-${axis === 'col' ? 'c' : 'r'}="${index}"]`;
  const handle = head.querySelector(selector);
  // Native browsers direct pointerup and the resulting clicks to the capture
  // owner, not the handle. A render between clicks may replace that handle.
  for (let i = 0; i < 2; i++) {
    pointer(head.querySelector(selector), 'pointerdown', axis);
    pointer(clip, 'pointerup', axis);
    clip.dispatchEvent(new Event('lostpointercapture'));
    grid.refresh();
    vi.advanceTimersByTime(1);
  }
  expect(head.querySelector(selector)).not.toBe(handle);
  document.elementFromPoint = vi.fn(() => head.querySelector(selector));
  clip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 148, clientY: 10 }));
  expect(document.elementFromPoint).toHaveBeenCalledWith(148, 10);
}

it.each([false, true])('fits a column after native capture retargets the double-click, frozen=%s', frozen => {
  const { wb, id } = setup({ frozen });
  capturedDoubleClick('col', 0, frozen);
  expect(wb.colWidth(id, 0)).toBe('The longest entry below the heading'.length * 7 + 14);
  expect(wb.colWidth(id, 1)).toBe(100);
  expect(wb.undoLabel()).toBe('Resize column');
  wb.undo(); expect(wb.colWidth(id, 0)).toBe(100); expect(wb.canUndo()).toBe(false);
  wb.redo(); expect(wb.colWidth(id, 0)).toBeGreaterThan(100);
});

it('fits each selected column separately in one undo step after capture', () => {
  const { wb, id } = setup();
  grid.selectByName('A:B');
  capturedDoubleClick('col');
  expect(wb.colWidth(id, 0)).toBeGreaterThan(100);
  expect(wb.colWidth(id, 1)).toBe(49);
  expect(wb.undoLabel()).toBe('Fit columns');
  wb.undo(); expect([0, 1].map(c => wb.colWidth(id, c))).toEqual([100, 100]);
  expect(wb.canUndo()).toBe(false);
});

it('also restores row-height AutoFit after the same capture sequence', () => {
  const { wb, id } = setup();
  capturedDoubleClick('row');
  expect(wb.rowHeight(id, 0)).toBe(ONE_LINE);
  wb.undo(); expect(wb.rowHeight(id, 0)).toBe(100);
});

it.each(['header', 'outside', 'missing'])('does not resize when the hit-tested target is %s', target => {
  const { wb, id } = setup();
  const clip = grid.el.querySelector('.grid-colhead-clip');
  const hit = target === 'header' ? clip.querySelector('.hcell') : target === 'outside' ? document.createElement('div') : null;
  document.elementFromPoint = () => hit;
  clip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 100, clientY: 10 }));
  expect(wb.colWidth(id, 0)).toBe(100); expect(wb.canUndo()).toBe(false);
});
