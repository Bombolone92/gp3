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

// A cell that became protected while its entry was being typed refused the write in silence, and the
// editor closed and moved on as if the entry had landed.
it('keeps the entry open when the cell was protected while it was being edited, so nothing is lost without a word', () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'old');
  const announced = [];
  const grid = createGrid({ wb, sheetId: id, announce: (t) => announced.push(t), onCommand() {} });
  document.body.replaceChildren(grid.el);
  try {
    grid.beginEdit({ text: 'new', mode: 'type' });
    const editor = grid.el.querySelector('.grid-editor');
    let refused = 0;
    wb.addEventListener('change', (e) => { if (e.detail?.type === 'protected') refused++; });
    wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'header');
    key(editor, 'Enter');
    expect(grid.editing).toBe(true);
    expect(editor.value).toBe('new');
    expect(wb.getValue(id, 0, 0)).toBe('old');
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(refused).toBe(1); // the workbook's own notice says why
    expect(document.activeElement).toBe(editor);
    key(editor, 'Escape');
    expect(grid.editing).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('old');
  } finally { grid.destroy(); }
});
