// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

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

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Bold label');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, italic: true });
  wb.setInput(id, 1, 0, 'plain');
  wb.setInput(id, 2, 0, '=1+1');
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bold: true });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, editor: grid.el.querySelector('.grid-editor') };
}

// The editor took the cell's size and family but not its weight or slant, so a bold label turned
// regular the moment editing began, while the caret maths measured it in bold and landed a
// character or two off.
describe('the in-cell editor of a bold or italic cell', () => {
  it('shows the text in the cell\'s weight and slant, the same font the caret is placed with', () => {
    const { grid, editor } = setup();
    grid.setSelection(S.single(0, 0));
    grid.beginEdit();
    expect(editor.style.fontWeight).toBe('600');
    expect(editor.style.fontStyle).toBe('italic');
    expect(grid.editState.font).toMatch(/^italic 600 13\.00px /);
    grid.cancelEdit();
  });

  it('goes back to regular for a plain cell', () => {
    const { grid, editor } = setup();
    grid.setSelection(S.single(0, 0));
    grid.beginEdit();
    grid.cancelEdit();
    grid.setSelection(S.single(1, 0));
    grid.beginEdit();
    expect(editor.style.fontWeight).toBe('');
    expect(editor.style.fontStyle).toBe('');
    expect(grid.editState.font).toMatch(/^13\.00px /);
    grid.cancelEdit();
  });

  it('keeps the weight for a formula, as the cell shows its result', () => {
    const { grid, editor } = setup();
    grid.setSelection(S.single(2, 0));
    grid.beginEdit();
    expect(editor.style.fontWeight).toBe('600');
    grid.cancelEdit();
  });
});
