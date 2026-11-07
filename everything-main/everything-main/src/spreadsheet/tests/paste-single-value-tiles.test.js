// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A copied block pasted over a selection that is a multiple of it fills the
// whole selection. That held for cells copied here, but text from another
// app, a web table, and "Paste values only" wrote one copy and stopped.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('pasteValues and pasteLiteralValues with a target', () => {
  it('tile a block across a selection that is a multiple of it, and only then', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.pasteValues(id, [['x']], 0, 0, { r1: 0, c1: 0, r2: 2, c2: 1 });
    expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 2, c2: 1 })).toEqual([['x', 'x'], ['x', 'x'], ['x', 'x']]);
    wb.pasteValues(id, [['1'], ['2']], 0, 3, { r1: 0, c1: 3, r2: 3, c2: 3 });
    expect(wb.rangeValues(id, { r1: 0, c1: 3, r2: 3, c2: 3 })).toEqual([[1], [2], [1], [2]]);
    // Three rows are not a multiple of two: one copy, at the top.
    wb.pasteValues(id, [['a'], ['b']], 0, 5, { r1: 0, c1: 5, r2: 2, c2: 5 });
    expect(wb.rangeValues(id, { r1: 0, c1: 5, r2: 2, c2: 5 })).toEqual([['a'], ['b'], [null]]);
    wb.pasteLiteralValues(id, [[7]], 10, 0, { r1: 10, c1: 0, r2: 11, c2: 2 });
    expect(wb.rangeValues(id, { r1: 10, c1: 0, r2: 11, c2: 2 })).toEqual([[7, 7, 7], [7, 7, 7]]);
    expect(wb.undoLabels()).toHaveLength(4);
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

  it('fills the selection from plain text, a web table, and Paste values only', async () => {
    const doc = new Doc({ name: 'Tiles', path: 'Spreadsheets/Tiles.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '9');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const data = {};
    const clipboardEvent = (type, payload = {}) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => payload[t] ?? '', setData: (t, v) => { data[t] = v; }, files: [] } });
      return e;
    };
    const nameBox = view.el.querySelector('[aria-label="Cell reference"]');

    view.goTo('Sheet1!B1:B3');
    viewport.dispatchEvent(clipboardEvent('paste', { 'text/plain': '5' }));
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.rangeValues(id, { r1: 0, c1: 1, r2: 2, c2: 1 })).toEqual([[5], [5], [5]]);
    expect(nameBox.value).toBe('B1:B3');

    view.goTo('Sheet1!C1:D2');
    viewport.dispatchEvent(clipboardEvent('paste', { 'text/html': '<table><tr><td>hi</td></tr></table>' }));
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.rangeValues(id, { r1: 0, c1: 2, r2: 1, c2: 3 })).toEqual([['hi', 'hi'], ['hi', 'hi']]);
    expect(nameBox.value).toBe('C1:D2');

    view.goTo('Sheet1!A1');
    viewport.dispatchEvent(clipboardEvent('copy'));
    view.goTo('Sheet1!E1:E4');
    view.el.querySelector('[data-menu="edit"]').click();
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    item('Paste special').click();
    item('Values only').click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(wb.rangeValues(id, { r1: 0, c1: 4, r2: 3, c2: 4 })).toEqual([[9], [9], [9], [9]]);
    expect(nameBox.value).toBe('E1:E4');
  });
});
