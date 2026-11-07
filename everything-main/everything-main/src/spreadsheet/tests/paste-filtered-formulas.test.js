// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Copying a filtered list takes the visible rows only, packed together. The
// paste then shifted every formula by its place in the packed block, so a
// formula from row 3 pasted two rows down pointed one row too far.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 3; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 1, `=A${r + 1}*2`); }
  return { wb, id };
}

describe('pasteCells with the source lines of a filtered copy', () => {
  it('shifts each formula by the distance its own cell moved', () => {
    const { wb, id } = book();
    wb.setHidden(id, 'row', [1], true);
    const { rows, cols } = wb.visibleIndices(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
    const cells = wb.copyCells(id, rows, cols);
    wb.pasteCells(id, cells, 10, 3, { r: 0, c: 0, rows, cols });
    expect(wb.getCell(id, 10, 4).f).toBe('D11*2');
    expect(wb.getCell(id, 11, 4).f).toBe('D12*2');
    expect([wb.getValue(id, 10, 4), wb.getValue(id, 11, 4)]).toEqual([2, 6]);
    // Transposed, each formula points at its row's value in its transposed place,
    // the packed rows read by where they were copied from: row 3's formula in E22 reads row 3's value in E21.
    wb.pasteCells(id, cells, 20, 3, { r: 0, c: 0, rows, cols }, null, { transpose: true });
    expect(wb.getCell(id, 21, 3).f).toBe('D21*2');
    expect(wb.getCell(id, 21, 4).f).toBe('E21*2');
    expect([wb.getValue(id, 21, 3), wb.getValue(id, 21, 4)]).toEqual([2, 6]);
  });

  it('keeps shifting a plain block by its origin', () => {
    const { wb, id } = book();
    wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 1 }), 10, 3, { r: 0, c: 0 });
    expect(wb.getCell(id, 12, 4).f).toBe('D13*2');
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

  it('pastes a copied filtered list with formulas that read the rows beside them', async () => {
    const doc = new Doc({ name: 'Filtered', path: 'Spreadsheets/Filtered.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'n');
    wb.setInput(id, 0, 1, 'double');
    for (let r = 1; r <= 3; r++) { wb.setInput(id, r, 0, String(r)); wb.setInput(id, r, 1, `=A${r + 1}*2`); }
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 1 });
    wb.setFilterCriteria(id, 0, { values: ['1', '3'] });
    expect([...wb.sheet(id).filterHidden]).toEqual([2]);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const data = {};
    const clipboardEvent = (type) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData: (t, v) => { data[t] = v; }, files: [] } });
      return e;
    };
    view.goTo('Sheet1!A2:B4');
    viewport.dispatchEvent(clipboardEvent('copy'));
    expect(data['text/plain']).toBe('1\t2\n3\t6');
    // Another tab is not told which rows were skipped, so it is not given an origin to shift by.
    expect(data['text/html']).not.toContain('data-spreadsheet-origin');
    view.goTo('Sheet1!D11');
    viewport.dispatchEvent(clipboardEvent('paste'));
    expect(wb.getCell(id, 10, 4).f).toBe('D11*2');
    expect(wb.getCell(id, 11, 4).f).toBe('D12*2');
    expect([wb.getValue(id, 10, 4), wb.getValue(id, 11, 4)]).toEqual([2, 6]);
    // A copy with nothing hidden still tells another tab where it came from.
    wb.setFilterCriteria(id, 0, null);
    view.goTo('Sheet1!A2:B4');
    viewport.dispatchEvent(clipboardEvent('copy'));
    expect(data['text/html']).toContain('data-spreadsheet-origin="1,0"');
  });
});
