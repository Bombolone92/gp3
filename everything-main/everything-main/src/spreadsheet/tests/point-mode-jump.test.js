// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
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
});
afterEach(() => { document.body.replaceChildren(); });

const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const mod = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true };

/** A sheet with numbers in A1:A5 and C1:C5, an edit begun in E1 (or `at`) with `text`. */
function setup(text, at = { r: 0, c: 4 }) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 5; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 2, String(r + 1)); }
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection({ active: at, anchor: at, focus: at });
  grid.beginEdit({ text, mode: 'type' });
  const editor = grid.el.querySelector('.grid-editor');
  editor.setSelectionRange(text.length, text.length);
  return { wb, id, grid, editor };
}

// Ctrl+Arrow was kept out of reference picking, so it fell through to the rule that Up and Down
// leave a typed cell, and committed the half-typed formula as #ERROR!.
it('jumps the pointed reference to the edge of the data with Ctrl+Arrow, as the selection would', () => {
  const { wb, id, grid, editor } = setup('=A1+');
  key(editor, 'ArrowLeft', mod);
  expect(grid.editing).toBe(true);
  expect(editor.value).toBe('=A1+C1');
  key(editor, 'ArrowDown', mod);
  expect(editor.value).toBe('=A1+C5');
  key(editor, 'ArrowUp', mod);
  expect(editor.value).toBe('=A1+C1');
  key(editor, 'ArrowLeft', mod);
  expect(editor.value).toBe('=A1+A1');
  key(editor, 'Enter');
  expect(wb.getCell(id, 0, 4).f).toBe('A1+A1');
  grid.destroy();
});

it('stretches the pointed range to the edge of the data with Ctrl+Shift+Arrow', () => {
  const { grid, editor } = setup('=SUM(', { r: 5, c: 2 });
  key(editor, 'ArrowUp');
  expect(editor.value).toBe('=SUM(C5');
  key(editor, 'ArrowUp', { ...mod, shiftKey: true });
  expect(editor.value).toBe('=SUM(C1:C5');
  expect(grid.editing).toBe(true);
  key(editor, 'Enter');
  expect(grid.editing).toBe(false);
  grid.destroy();
});

it('still lets Ctrl+Arrow move the caret when the formula does not want a reference', () => {
  const { grid, editor } = setup('=A1+1');
  expect(key(editor, 'ArrowLeft', mod)).toBe(true);
  expect(editor.value).toBe('=A1+1');
  expect(grid.editing).toBe(true);
  grid.destroy();
});
