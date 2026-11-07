// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
// A default row on screen at 100%; presses go through row 1's middle, clear of the fill handle at A1's bottom-right corner.
const ROW = Math.round(DEFAULT_ROW_HEIGHT);
const ROW1_MID = ROW / 2;

// Dragging a selection's border with Alt copies it. Onto a protected range the workbook writes
// nothing (and reports the protected cell itself), but the grid still said "Copied to B1" and
// moved the selection there, as if the copy had landed.
it('keeps the selection and says nothing when an Alt-drag copy lands on a protected range', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'x');
  wb.protectRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  const announced = [];
  const grid = createGrid({ wb, sheetId: id, announce: (t) => announced.push(t) });
  document.body.replaceChildren(grid.el);
  await flush();
  grid.setSelection(S.single(0, 0));
  announced.length = 0;
  const pe = (type, x) => grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: ROW1_MID, pointerId: 1, button: 0, pointerType: 'mouse', altKey: true }));
  pe('pointerdown', 100); // A1's right border
  pe('pointermove', 200);
  pe('pointerup', 200); // over B1, which is protected
  await flush();
  expect(wb.getValue(id, 0, 1)).toBeNull();
  expect(announced).toEqual([]);
  expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  // Onto a free cell the copy lands and is announced as before.
  pe('pointerdown', 100);
  pe('pointermove', 300);
  pe('pointerup', 300);
  await flush();
  expect(wb.getValue(id, 0, 2)).toBe('x');
  expect(announced).toEqual(['C1, x', 'Copied to C1']);
  expect(grid.range).toEqual({ r1: 0, c1: 2, r2: 0, c2: 2 });
  grid.destroy();
});
it('Alt-drag copies blank native sparkline cells as live group members and undoes once', async () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Sheet', sparklineGroups: [{ sparklines: [{ ref: 'A1', formula: 'G1:H1' }] }] }] });
  const grid = createGrid({ wb, sheetId: 's' }); document.body.replaceChildren(grid.el); await flush();
  const before = structuredClone(wb.sheet('s').sparklineGroups);
  grid.setSelection(S.single(0, 0));
  const pe = (type, x) => grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: ROW1_MID, pointerId: 1, button: 0, pointerType: 'mouse', altKey: true }));
  pe('pointerdown', 100); pe('pointermove', 200); pe('pointerup', 200); await flush();
  expect(wb.sheet('s').sparklineGroups[0].sparklines).toEqual([{ ref: 'A1', formula: 'G1:H1' }, { ref: 'B1', formula: 'H1:I1' }]);
  wb.undo(); expect(wb.sheet('s').sparklineGroups).toEqual(before); grid.destroy();
});
