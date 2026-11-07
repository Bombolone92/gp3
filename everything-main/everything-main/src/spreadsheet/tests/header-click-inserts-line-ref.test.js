// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid, COL_HEADER_H } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
// The middle of 0-based row r on the screen: the viewport starts below the column header.
const rowMidY = (r) => COL_HEADER_H + r * ROW + ROW / 2;

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
  wb.setInput(id, 0, 1, '4');
  wb.setInput(id, 1, 1, '5');
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 48, top: COL_HEADER_H, right: 848, bottom: COL_HEADER_H + 400, width: 800, height: 400 });
  const colClip = grid.el.querySelector('.grid-colhead-clip');
  const rowClip = grid.el.querySelector('.grid-rowhead-clip');
  const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));
  const editor = grid.el.querySelector('.grid-editor');
  const typeFormula = (text) => { grid.beginEdit({ text, mode: 'type' }); editor.focus(); editor.setSelectionRange(text.length, text.length); };
  return { wb, id, grid, colClip, rowClip, pointer, editor, typeFormula };
}

// Clicking a header while a formula wanted a reference committed the formula and selected the
// line; it now puts B:B or 2:2 into the formula instead.
describe('a header press while a formula expects a reference', () => {
  it('inserts the whole column, stretching across the columns dragged over', () => {
    const { wb, id, grid, colClip, pointer, editor, typeFormula } = mount();
    typeFormula('=SUM(');
    pointer(colClip.querySelector('.hcell[data-c="1"]'), 'pointerdown', { clientX: 198, clientY: 13 });
    expect(grid.editing).toBe(true);
    expect(editor.value).toBe('=SUM(B:B');
    pointer(colClip, 'pointermove', { clientX: 398, clientY: 13 });
    expect(editor.value).toBe('=SUM(B:D');
    pointer(colClip, 'pointerup', { clientX: 398, clientY: 13 });
    expect(grid.editing).toBe(true);
    expect(document.activeElement).toBe(editor);
    editor.value = '=SUM(B:D)';
    editor.dispatchEvent(new Event('input'));
    grid.commitEdit();
    expect(wb.getValue(id, 0, 0)).toBe(9);
  });

  it('inserts the whole row from a row header', () => {
    const { grid, rowClip, pointer, editor, typeFormula } = mount();
    grid.setSelection({ active: { r: 4, c: 0 }, anchor: { r: 4, c: 0 }, focus: { r: 4, c: 0 } });
    typeFormula('=SUM(');
    pointer(rowClip.querySelector('.hcell[data-r="1"]'), 'pointerdown', { clientX: 20, clientY: rowMidY(1) });
    expect(editor.value).toBe('=SUM(2:2');
    pointer(rowClip, 'pointermove', { clientX: 20, clientY: rowMidY(2) });
    expect(editor.value).toBe('=SUM(2:3');
    pointer(rowClip, 'pointerup', { clientX: 20, clientY: rowMidY(2) });
    expect(grid.editing).toBe(true);
    grid.cancelEdit();
  });

  it('still commits plain text and selects the column', () => {
    const { wb, id, grid, colClip, pointer, typeFormula } = mount();
    typeFormula('hello');
    pointer(colClip.querySelector('.hcell[data-c="1"]'), 'pointerdown', { clientX: 198, clientY: 13 });
    pointer(colClip, 'pointerup', { clientX: 198, clientY: 13 });
    expect(grid.editing).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('hello');
    expect(grid.range).toMatchObject({ c1: 1, c2: 1, r1: 0 });
  });
});
