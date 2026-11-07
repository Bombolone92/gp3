// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Copying cells left their notes behind: only a move carried them. Now a
// copy takes the notes along and an ordinary paste writes them, in the same
// undo step as the cells.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('pasteCells with notes', () => {
  it('writes them with the cells as one step, tiled and transposed like the cells', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 0, 1, 'b');
    wb.setNote(id, 5, 5, 'old note here');
    wb.clearHistory();
    const cells = wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    const notes = [['first', null]];
    wb.pasteCells(id, cells, 5, 5, { r: 0, c: 0 }, { r1: 5, c1: 5, r2: 6, c2: 6 }, { notes });
    expect(wb.getValue(id, 6, 6)).toBe('b');
    expect(wb.getNote(id, 5, 5)).toBe('first');
    expect(wb.getNote(id, 6, 5)).toBe('first');
    expect(wb.getNote(id, 5, 6)).toBeNull(); // the source had none: whatever was there goes
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect(wb.getValue(id, 6, 6)).toBeNull();
    expect(wb.getNote(id, 5, 5)).toBe('old note here');
    expect(wb.getNote(id, 6, 5)).toBeNull();
    wb.pasteCells(id, cells, 10, 0, { r: 0, c: 0 }, null, { transpose: true, notes });
    expect(wb.getValue(id, 11, 0)).toBe('b');
    expect(wb.getNote(id, 10, 0)).toBe('first');
    expect(wb.getNote(id, 11, 0)).toBeNull();
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
  afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it.each(['first', '  Indented\nLast line  \n'])('copies note %j with the cells, but not with values or formatting only', async (note) => {
    const doc = new Doc({ name: 'Notes', path: 'Spreadsheets/Notes.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 1, 0, 'b');
    wb.setNote(id, 0, 0, note);
    wb.setNote(id, 4, 1, 'old');
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const clipboardEvent = (type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: () => '', setData() {}, files: [] } });
      return e;
    };
    view.goTo('Sheet1!A1:A2');
    viewport.dispatchEvent(clipboardEvent('copy'));
    view.goTo('Sheet1!B5');
    viewport.dispatchEvent(clipboardEvent('paste'));
    expect(wb.getValue(id, 4, 1)).toBe('a');
    expect(wb.getNote(id, 4, 1)).toBe(note);
    expect(wb.getNote(id, 5, 1)).toBeNull();
    expect(wb.undoLabels()).toHaveLength(1);
    // The source keeps its note: this was a copy.
    expect(wb.getNote(id, 0, 0)).toBe(note);

    const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    view.goTo('Sheet1!D1');
    view.el.querySelector('[data-menu="edit"]').click();
    item('Paste special').click();
    item('Values only').click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(wb.getValue(id, 0, 3)).toBe('a');
    expect(wb.getNote(id, 0, 3)).toBeNull();

    view.goTo('Sheet1!F1');
    view.el.querySelector('[data-menu="edit"]').click();
    item('Paste special').click();
    item('Transposed').click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(wb.getValue(id, 0, 6)).toBe('b');
    expect(wb.getNote(id, 0, 5)).toBe(note);
    expect(wb.getNote(id, 0, 6)).toBeNull();
  });
});
