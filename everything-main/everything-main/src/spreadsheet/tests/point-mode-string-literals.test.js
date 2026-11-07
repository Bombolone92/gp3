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

/** An edit of `text` in C3 with the caret at its end, then one press of `k`; the editor's text and whether the edit is still open. */
function press(text, k, init = {}) {
  const wb = new Workbook();
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  try {
    grid.setSelection({ active: { r: 2, c: 2 }, anchor: { r: 2, c: 2 }, focus: { r: 2, c: 2 } });
    grid.beginEdit({ text, mode: 'type' });
    const editor = grid.el.querySelector('.grid-editor');
    editor.setSelectionRange(text.length, text.length);
    key(editor, k, init);
    return { text: editor.value, editing: grid.editing, acceptsRef: grid.acceptsRef() };
  } finally { grid.destroy(); }
}

// Only the last character before the caret decided whether a formula wanted a reference, so a comma
// or a parenthesis inside quoted text turned the arrow keys into reference picking.
it('does not pick a reference with the arrows while the caret is inside quoted text', () => {
  expect(press('=A1&"hello, ', 'ArrowLeft')).toMatchObject({ text: '=A1&"hello, ', acceptsRef: false });
  expect(press('=IF(A1="(', 'ArrowLeft')).toMatchObject({ text: '=IF(A1="(', acceptsRef: false });
  // A closed string is an operand like any other: after an operator the arrows pick again.
  expect(press('=A1&"hello, "&', 'ArrowLeft')).toMatchObject({ text: '=A1&"hello, "&B3', acceptsRef: true });
  expect(press('=SUM(', 'ArrowLeft')).toMatchObject({ text: '=SUM(B3', acceptsRef: true });
});
