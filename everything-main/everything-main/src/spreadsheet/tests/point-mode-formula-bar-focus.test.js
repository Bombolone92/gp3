// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

// Releasing a reference drag focused the in-cell editor even when the formula was being typed in
// the formula bar, so the next keystroke landed in the wrong box.
describe('picking a reference by mouse while typing in the formula bar', () => {
  it('leaves the focus in the formula bar', () => {
    const wb = new Workbook();
    const grid = createGrid({ wb, sheetId: wb.sheets[0].id });
    document.body.replaceChildren(grid.el);
    vi.runOnlyPendingTimers();
    const bar = document.createElement('input');
    document.body.append(bar);
    grid.setFormulaInput(bar);
    grid.beginEdit({ text: '=', mode: 'edit', focusEditor: false });
    bar.value = '=';
    bar.focus();
    bar.setSelectionRange(1, 1);
    const pe = (type, x, y) => grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 2, button: 0, pointerType: 'mouse' }));
    pe('pointerdown', 150, 13); // B1
    pe('pointermove', 150, 39); // B2
    pe('pointerup', 150, 39);
    expect(bar.value).toBe('=B1:B2');
    expect(document.activeElement).toBe(bar);
    // Typed in the cell itself, the release keeps the cell editor.
    grid.cancelEdit();
    grid.beginEdit({ text: '=', mode: 'type' });
    const editor = grid.el.querySelector('.grid-editor');
    editor.focus();
    editor.setSelectionRange(1, 1);
    pe('pointerdown', 150, 13);
    pe('pointerup', 150, 13);
    expect(editor.value).toBe('=B1');
    expect(document.activeElement).toBe(editor);
    grid.destroy();
  });
});
