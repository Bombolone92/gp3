// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

/** Cut = copy the cells and remember where they were; placeMoved clears them as they land. */
function cut(wb, id, range) {
  return { cells: wb.copyRange(id, range), from: { sheetId: id, range } };
}

describe('placeMoved', () => {
  it('moves references with the cut cells and keeps the moved formulas on target', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '10');
    wb.setInput(id, 1, 0, '=A1+1');
    wb.setInput(id, 0, 1, '=A1*2');
    wb.defineName('Start', 'Sheet1!$A$1');
    const { cells, from } = cut(wb, id, { r1: 0, c1: 0, r2: 1, c2: 0 });
    expect(wb.placeMoved(id, 4, 2, cells, from)).toEqual({ r1: 4, c1: 2, r2: 5, c2: 2 });
    expect(wb.getCell(id, 5, 2).f).toBe('C5+1');
    expect(wb.getCell(id, 0, 1).f).toBe('C5*2');
    expect([wb.getValue(id, 4, 2), wb.getValue(id, 5, 2), wb.getValue(id, 0, 1)]).toEqual([10, 11, 20]);
    expect(wb.namedRef('Start', 'Sheet1')).toMatchObject({ r1: 4, c1: 2 });
    // A formula pointing outside the block keeps its target.
    wb.setInput(id, 0, 3, '10');
    wb.setInput(id, 1, 3, '=D1+1');
    const second = cut(wb, id, { r1: 1, c1: 3, r2: 1, c2: 3 });
    wb.placeMoved(id, 8, 5, second.cells, second.from);
    expect(wb.getCell(id, 8, 5).f).toBe('D1+1');
    expect(wb.getValue(id, 8, 5)).toBe(11);
  });

  it('qualifies references when the block changes sheets', () => {
    const wb = new Workbook();
    const one = wb.activeSheetId;
    const two = wb.addSheet('Second').id;
    wb.setInput(one, 0, 0, '5');
    wb.setInput(one, 1, 0, '=A1*2');
    wb.setInput(one, 0, 1, '=A2');
    wb.setInput(one, 0, 2, '7');
    wb.setInput(one, 2, 0, '=C1+A1');
    const block = cut(wb, one, { r1: 0, c1: 0, r2: 2, c2: 0 });
    wb.placeMoved(two, 0, 0, block.cells, block.from);
    expect(wb.getCell(two, 1, 0).f).toBe('A1*2');
    expect(wb.getCell(two, 2, 0).f).toBe('Sheet1!C1+A1');
    expect(wb.getCell(one, 0, 1).f).toBe('Second!A2');
    expect([wb.getValue(two, 1, 0), wb.getValue(two, 2, 0), wb.getValue(one, 0, 1)]).toEqual([10, 12, 10]);
  });

  it('refuses a protected destination', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.protectRange(id, { r1: 5, c1: 5, r2: 5, c2: 5 }, 'Keep');
    const block = cut(wb, id, { r1: 0, c1: 0, r2: 0, c2: 0 });
    expect(wb.placeMoved(id, 5, 5, block.cells, block.from)).toBe(null);
  });
});

describe('cut and paste in the editor', () => {
  let view;
  const canvas = { font: '', measureText: (text) => ({ width: text.length * 7 }) };
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvas);
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    view?.destroy();
    view = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  const clipboardEvent = (type) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '', setData() {}, files: [] } });
    return e;
  };

  it('moves a formula and its dependents, then pastes again as a copy', async () => {
    const doc = new Doc({ name: 'Cut', path: 'Spreadsheets/Cut.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    wb.setInput(id, 0, 1, '=A1*2');
    wb.setInput(id, 0, 2, '=B1');
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    view.goTo('Sheet1!B1');
    viewport.dispatchEvent(clipboardEvent('cut'));
    expect(wb.getCell(id, 0, 1).f).toBe('A1*2'); // nothing moves until the paste
    view.goTo('Sheet1!B3');
    viewport.dispatchEvent(clipboardEvent('paste'));
    expect(wb.getCell(id, 0, 1)).toBeFalsy();
    expect(wb.getCell(id, 2, 1).f).toBe('A1*2');
    expect(wb.getCell(id, 0, 2).f).toBe('B3');
    expect(wb.getValue(id, 0, 2)).toBe(10);
    // The second paste of the same clip is a copy.
    view.goTo('Sheet1!B5');
    viewport.dispatchEvent(clipboardEvent('paste'));
    expect(wb.getCell(id, 4, 1).f).toBe('A5*2');
    expect(wb.getCell(id, 0, 2).f).toBe('B3');
  });
});
