// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_COLS } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Split text to columns wrote its pieces wherever they fell: past the last
// column, where they were dropped while the split was reported as written, or
// under a merged block, where they were stored out of sight. Both splits are
// now refused, and the editor says why.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('split text to columns', () => {
  it('refuses pieces that would run past the last column instead of dropping them', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.ensureSize(id, 100, MAX_COLS);
    wb.setInput(id, 0, MAX_COLS - 2, 'a,b,c,d');
    wb.setInput(id, 1, MAX_COLS - 2, 'e,f');
    wb.clearHistory();
    const before = JSON.stringify(wb.toJSON());
    expect(wb.splitTextToColumns(id, { r1: 0, c1: MAX_COLS - 2, r2: 1, c2: MAX_COLS - 2 })).toEqual({ rows: 0, cols: 0, reason: 'room' });
    expect(JSON.stringify(wb.toJSON())).toBe(before);
    expect(wb.canUndo()).toBe(false);
    // Pieces that end exactly at the last column fit.
    expect(wb.splitTextToColumns(id, { r1: 1, c1: MAX_COLS - 2, r2: 1, c2: MAX_COLS - 2 })).toEqual({ rows: 1, cols: 2 });
    expect([MAX_COLS - 2, MAX_COLS - 1].map((c) => wb.getValue(id, 1, c))).toEqual(['e', 'f']);
  });

  it('refuses a piece that would land under a merged block, and keeps the merge', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a,b,c');
    wb.setInput(id, 1, 0, 'd,e');
    wb.mergeCells(id, parseRange('B1:C1'));
    wb.clearHistory();
    const before = JSON.stringify(wb.toJSON());
    expect(wb.splitTextToColumns(id, parseRange('A1:A2'))).toEqual({ rows: 0, cols: 0, reason: 'merged' });
    expect(JSON.stringify(wb.toJSON())).toBe(before);
    expect(wb.canUndo()).toBe(false);
    // A piece on the merge's own first cell shows there like any value; only cells under the merge are out of sight.
    expect(wb.splitTextToColumns(id, parseRange('A2'))).toEqual({ rows: 1, cols: 2 });
    expect([0, 1].map((c) => wb.getValue(id, 1, c))).toEqual(['d', 'e']);
    wb.setInput(id, 2, 0, 'f,g');
    wb.mergeCells(id, parseRange('B3:B4'));
    expect(wb.splitTextToColumns(id, parseRange('A3'))).toEqual({ rows: 1, cols: 2 });
    expect(wb.getValue(id, 2, 1)).toBe('g');
  });

  it('uses the whole width of the grid on a sheet not yet scrolled that far', () => {
    const wb = new Workbook({ sheets: [{ name: 'Wide', rows: 10, cols: 702, cells: { '0,701': { v: 'a,b,c' } } }] });
    const id = wb.activeSheetId;
    expect(wb.splitTextToColumns(id, { r1: 0, c1: 701, r2: 0, c2: 701 })).toEqual({ rows: 1, cols: 3 });
    expect([701, 702, 703].map((c) => wb.getValue(id, 0, c))).toEqual(['a', 'b', 'c']);
  });
});

describe('the editor', () => {
  let view;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.scrollTo = () => {};
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  async function mount(prep, cell) {
    const doc = new Doc({ name: 'Split', path: 'Spreadsheets/Split.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    prep(wb, id);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const name = view.el.querySelector('[aria-label="Cell reference"]');
    name.value = cell;
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    return { wb, id, toast: vi.spyOn(notifications, 'toast'), before: JSON.stringify(wb.toJSON()) };
  }
  const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
  async function split() {
    view.el.querySelector('[data-menu="data"]').click();
    menuItem('Data cleanup').click();
    menuItem('Split text to columns').click();
    await vi.advanceTimersByTimeAsync(1);
  }

  it('says the pieces would run past the last column instead of reporting a split', async () => {
    const { wb, toast, before } = await mount((wb, id) => { wb.ensureSize(id, 100, MAX_COLS); wb.setInput(id, 0, MAX_COLS - 1, 'a,b'); }, 'XFD1');
    await split();
    expect(toast).toHaveBeenCalledWith("Can't split: the pieces would run past the last column", expect.objectContaining({ icon: 'info' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Split/), expect.anything());
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });

  it('says the pieces would land under merged cells instead of reporting a split', async () => {
    const { wb, toast, before } = await mount((wb, id) => { wb.setInput(id, 0, 0, 'a,b,c'); wb.mergeCells(id, parseRange('B1:C1')); }, 'A1');
    await split();
    expect(toast).toHaveBeenCalledWith("Can't split: the pieces would land under merged cells", expect.objectContaining({ icon: 'info' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Split/), expect.anything());
    expect(JSON.stringify(wb.toJSON())).toBe(before);
  });
});
