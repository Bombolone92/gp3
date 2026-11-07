// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A cut leaves its cells in place until the paste moves them, but nothing on
// the sheet showed which cells were cut: the grid now outlines them until the
// paste, Escape, a copy, typing, or any other change ends the cut.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Element.prototype.setPointerCapture = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const frame = () => vi.advanceTimersByTimeAsync(1);

describe('grid.setCutRange', () => {
  it('draws a box over the range on its own sheet and hides it elsewhere or when cleared', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const other = wb.addSheet('Other').id;
    wb.setFrozen(id, 1, 0);
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await frame();
    const box = grid.el.querySelector('.grid-canvas > .cut-range');
    expect(box.hidden).toBe(true);
    grid.setCutRange({ r1: 1, c1: 0, r2: 2, c2: 1 });
    expect(box.hidden).toBe(false);
    // Boxed as the selection of the same range would be.
    grid.selectByName('A2:B3');
    await frame();
    const sel = grid.el.querySelector('.grid-canvas > .sel-range');
    expect([box.style.transform, box.style.width, box.style.height]).toEqual([sel.style.transform, sel.style.width, sel.style.height]);
    expect(box.style.transform).toMatch(/^translate\(0px, \d+px\)$/);
    await frame();
    // The frozen panes carry a copy of the overlays, this one included.
    expect(grid.el.querySelectorAll('.cut-range').length).toBeGreaterThan(1);
    grid.setSheet(other);
    await frame();
    expect(box.hidden).toBe(true);
    grid.setSheet(id);
    await frame();
    expect(box.hidden).toBe(false);
    grid.setCutRange(null);
    await frame();
    expect(box.hidden).toBe(true);
    grid.destroy();
  });
});

describe('the cut outline in the editor', () => {
  const clipboardEvent = (type) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '', setData() {}, files: [] } });
    return e;
  };

  async function mount() {
    const doc = new Doc({ name: 'Cut', path: 'Spreadsheets/Cut.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    wb.setInput(id, 1, 0, '6');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await frame();
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const box = view.el.querySelector('.grid-canvas > .cut-range');
    const cut = async (where) => { view.goTo(`Sheet1!${where}`); viewport.dispatchEvent(clipboardEvent('cut')); await frame(); };
    return { wb, id, viewport, box, cut };
  }

  it('shows the cut cells until the paste moves them', async () => {
    const { wb, id, viewport, box, cut } = await mount();
    await cut('A1:A2');
    expect(box.hidden).toBe(false);
    const sel = view.el.querySelector('.grid-canvas > .sel-range');
    expect([box.style.transform, box.style.width, box.style.height]).toEqual([sel.style.transform, sel.style.width, sel.style.height]);
    view.goTo('Sheet1!C1');
    await frame();
    expect(box.hidden).toBe(false); // selecting the destination keeps the cut
    viewport.dispatchEvent(clipboardEvent('paste'));
    await frame();
    expect(wb.getValue(id, 0, 2)).toBe(5);
    expect(box.hidden).toBe(true);
  });

  it('goes with Escape, a copy, typing into a cell, or another change to the workbook', async () => {
    const { wb, id, viewport, box, cut } = await mount();
    await cut('A1');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await frame();
    expect(box.hidden).toBe(true);
    await cut('A1');
    view.goTo('Sheet1!A2');
    viewport.dispatchEvent(clipboardEvent('copy'));
    await frame();
    expect(box.hidden).toBe(true);
    await cut('A1');
    view.goTo('Sheet1!B1');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    expect(box.hidden).toBe(true); // ended as the edit begins, not a frame later
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await cut('A1');
    wb.setInput(id, 5, 5, 'elsewhere');
    await frame();
    expect(box.hidden).toBe(true);
    // After any of these a paste copies the cut cells, which stay where they were.
    view.goTo('Sheet1!C1');
    viewport.dispatchEvent(clipboardEvent('paste'));
    expect([wb.getValue(id, 0, 0), wb.getValue(id, 0, 2)]).toEqual([5, 5]);
  });

  it('is drawn only while the cut cells\' sheet is shown', async () => {
    const { wb, box, cut } = await mount();
    const other = wb.addSheet('Other').id;
    wb.setActiveSheet(wb.sheets[0].id);
    await frame();
    await cut('A1:A2');
    wb.setActiveSheet(other);
    await frame();
    expect(box.hidden).toBe(true);
    wb.setActiveSheet(wb.sheets[0].id);
    await frame();
    expect(box.hidden).toBe(false);
  });
});
