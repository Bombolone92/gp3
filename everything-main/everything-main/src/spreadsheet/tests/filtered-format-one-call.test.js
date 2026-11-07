// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Clearing or formatting a filtered selection went to the workbook once per run of shown rows, and
// clearRange walked every cell of the sheet each time: select all over 20,000 alternately hidden
// rows made 10,000 calls (a minute or more) and as many history entries to undo. The workbook now
// takes the rows to skip, so the editor makes one call per selected range.

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('the workbook skips rows on request', () => {
  function sheet() {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 2; c++) wb.setInput(id, r, c, `${r},${c}`);
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 5, c2: 1 }, { italic: true });
    wb.clearHistory();
    return { wb, id, odd: (r) => r % 2 === 1 };
  }

  it('applyStyle leaves the skipped rows alone and records one step', () => {
    const { wb, id, odd } = sheet();
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 5, c2: 1 }, { bold: true }, { skipRow: odd });
    expect([0, 1, 2, 3, 4, 5].map((r) => !!wb.getCell(id, r, 0)?.s?.bold)).toEqual([true, false, true, false, true, false]);
    expect(wb.undoLabels()).toEqual(['Format']);
    wb.undo();
    expect([0, 1, 2, 3, 4, 5].map((r) => !!wb.getCell(id, r, 0)?.s?.bold)).toEqual([false, false, false, false, false, false]);
  });

  it('clearRange leaves the skipped rows alone, for contents and for styles, and records one step', () => {
    const { wb, id, odd } = sheet();
    wb.clearRange(id, { r1: 0, c1: 0, r2: 5, c2: 1 }, { contents: true, skipRow: odd });
    expect([0, 1, 2, 3, 4, 5].map((r) => wb.getValue(id, r, 1))).toEqual([null, '1,1', null, '3,1', null, '5,1']);
    expect([0, 1].map((r) => !!wb.getCell(id, r, 1)?.s?.italic)).toEqual([true, true]); // contents only
    wb.clearRange(id, { r1: 0, c1: 0, r2: 5, c2: 1 }, { contents: false, styles: true, skipRow: odd });
    expect([0, 1, 2, 3].map((r) => !!wb.getCell(id, r, 1)?.s?.italic)).toEqual([false, true, false, true]);
    expect(wb.undoLabels()).toEqual(['Clear', 'Clear']);
  });

  it('clearRange over a small range of a big sheet clears the same cells as before', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const entries = [];
    for (let r = 0; r < 300; r++) entries.push({ r, c: 0, cell: { v: r, f: null } }, { r, c: 3, cell: { v: -r, f: null, s: { bold: true } } });
    wb.setCells(id, entries);
    wb.clearHistory();
    wb.clearRange(id, { r1: 10, c1: 0, r2: 12, c2: 5 });
    expect([9, 10, 11, 12, 13].map((r) => wb.getValue(id, r, 0))).toEqual([9, null, null, null, 13]);
    expect([9, 10, 12, 13].map((r) => wb.getValue(id, r, 3))).toEqual([-9, null, null, -13]);
    expect(wb.getCell(id, 11, 3)?.s?.bold).toBe(true); // contents only: the style stays
    expect(wb.undoLabels()).toEqual(['Clear']);
  });
});

describe('the editor clears and formats a filtered selection in one call per range', () => {
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

  /** Column A keeps only "a" rows: rows 3, 5 and 7 (1-based) are hidden, cutting B2:B8 into four runs. */
  async function open() {
    const doc = new Doc({ name: 'Filtered', path: 'Spreadsheets/Filtered.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    [['Key', 'Value'], ['a', '1'], ['b', '2'], ['a', '3'], ['b', '4'], ['a', '5'], ['b', '6'], ['a', '7']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 7, c2: 1 });
    wb.setFilterCriteria(id, 0, { formula: 'A2="a"' });
    expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 4, 6]);
    wb.clearHistory();
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.goTo('Sheet1!B2:B8');
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const key = (k, init = {}) => viewport.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    const column = () => [1, 2, 3, 4, 5, 6, 7].map((r) => wb.getValue(id, r, 1));
    return { wb, id, key, column };
  }

  it('Delete clears the shown rows with one clearRange call and one undo step', async () => {
    const { wb, id, key, column } = await open();
    const clearRange = vi.spyOn(wb, 'clearRange');
    key('Delete');
    expect(column()).toEqual([null, 2, null, 4, null, 6, null]);
    expect(clearRange).toHaveBeenCalledTimes(1);
    expect(wb.undoLabels()).toEqual(['Clear']);
    wb.undo();
    expect(column()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(wb.getCell(id, 2, 1)?.v).toBe(2);
  });

  it('Ctrl+B formats the shown rows with one applyStyle call, and Clear Formats clears the formatting the same way', async () => {
    const { wb, id, key } = await open();
    const applyStyle = vi.spyOn(wb, 'applyStyle');
    const clearRange = vi.spyOn(wb, 'clearRange');
    key('b', { ctrlKey: true });
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => !!wb.getCell(id, r, 1)?.s?.bold)).toEqual([true, false, true, false, true, false, true]);
    expect(applyStyle).toHaveBeenCalledTimes(1);
    expect(wb.undoLabels()).toEqual(['Format']);
    // Home ▸ Clear ▸ Clear Formats (Ctrl+\\ selects row differences).
    document.querySelector('.ribbon-home button[aria-label="Clear"]').click();
    [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === 'Clear Formats').click();
    await vi.advanceTimersByTimeAsync(1);
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => !!wb.getCell(id, r, 1)?.s?.bold)).toEqual([false, false, false, false, false, false, false]);
    expect(clearRange).toHaveBeenCalledTimes(1);
    expect(wb.undoLabels()).toEqual(['Clear', 'Format']);
  });
});
