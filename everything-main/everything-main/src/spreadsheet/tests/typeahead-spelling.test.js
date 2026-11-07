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

function setup(values) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  values.forEach((v, r) => wb.setInput(id, r, 0, v));
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  const at = { r: values.length, c: 0 };
  grid.setSelection({ active: at, anchor: at, focus: at });
  return { wb, id, grid, row: at.r, viewport: grid.el.querySelector('.grid-viewport'), editor: grid.el.querySelector('.grid-editor') };
}

// The suggestion kept the letters as they were typed and finished the word from the entry above, so
// "aP" became "aPple"; and the first keystroke opened the editor without looking for a suggestion.
it('suggests the existing entry in its own spelling from the first letter typed', () => {
  const { wb, id, grid, row, viewport, editor } = setup(['Apple']);
  key(viewport, 'a');
  expect(editor.value).toBe('Apple');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 5]);
  expect(grid.editState.text).toBe('Apple');
  // Typing on replaces the selected part; the suggestion comes back in the entry's spelling.
  editor.value = 'aP';
  editor.setSelectionRange(2, 2);
  editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'P', bubbles: true }));
  expect(editor.value).toBe('Apple');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 5]);
  key(editor, 'Enter');
  expect(wb.getValue(id, row, 0)).toBe('Apple');
});

it('leaves the first letter alone when nothing in the column starts with it, or more than one entry does', () => {
  const { grid, viewport, editor } = setup(['Apple', 'Apricot']);
  key(viewport, 'a');
  expect(editor.value).toBe('a');
  expect(grid.editState.text).toBe('a');
  key(editor, 'Escape');
  key(viewport, 'z');
  expect(editor.value).toBe('z');
  key(editor, 'Escape');
});
