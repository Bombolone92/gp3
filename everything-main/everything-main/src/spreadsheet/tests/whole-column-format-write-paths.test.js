// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

/** Typed values keep destination defaults; copied cells replace the full format. */
const wholeCol = (wb, id, c) => ({ r1: 0, c1: c, r2: wb.sheet(id).rows - 1, c2: c });

function book() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.applyStyle(id, wholeCol(wb, id, 1), { fmt: 'currency', cur: 'USD', dec: 2, bg: '#ffeeee' });
  wb.ensureSize(id, 400, 26);
  return { wb, id };
}

describe('a value written into a formatted column far below the stored cells', () => {
  it('keeps column formats for typed entries and replaces them for copied cells', () => {
    const { wb, id } = book();
    wb.setInput(id, 250, 1, '10');
    wb.pasteCells(id, [[{ v: 20, f: null }], [{ v: 30, f: null }]], 251, 1, { r: 0, c: 0 });
    expect(wb.getCell(id, 250, 1).s).toMatchObject({ fmt: 'currency', bg: '#ffeeee' });
    expect(wb.styleAt(id, 251, 1)).toMatchObject({ fmt: null, cur: null, dec: null, bg: null });
    expect(wb.styleAt(id, 252, 1)).toMatchObject({ fmt: null, bg: null });
  });

  it('replaces formats for transpose and keeps them for formulas only', () => {
    const { wb, id } = book();
    wb.pasteCells(id, [[{ v: 20, f: null }, { v: 21, f: null }]], 260, 1, { r: 0, c: 0 }, null, { transpose: true });
    expect(wb.styleAt(id, 260, 1)).toMatchObject({ bg: null });
    expect(wb.styleAt(id, 261, 1)).toMatchObject({ bg: null });
    wb.pasteCells(id, [[{ v: 5, f: null, s: { bold: true } }]], 270, 1, { r: 0, c: 0 }, null, { keepStyles: true });
    expect(wb.styleAt(id, 270, 1)).toMatchObject({ fmt: 'currency', bg: '#ffeeee' });
    expect(wb.styleAt(id, 270, 1).bold).toBeUndefined(); // formulas only keeps the destination's formatting
  });

  it('copies percent formatting without acquiring the destination fill', () => {
    const { wb, id } = book();
    wb.pasteCells(id, [[{ v: 0.25, f: null, s: { fmt: 'percent', dec: 0 } }]], 280, 1, { r: 0, c: 0 });
    expect(wb.getDisplay(id, 280, 1)).toBe('25%');
    expect(wb.getCell(id, 280, 1).s).toMatchObject({ fmt: 'percent', dec: 0, bg: null });
  });

  it('takes it when the fill handle is dragged into it', () => {
    const { wb, id } = book();
    wb.setCells(id, [{ r: 300, c: 1, cell: { v: 1, f: null } }, { r: 301, c: 1, cell: { v: 2, f: null } }], 'Import');
    wb.fill(id, { r1: 300, c1: 1, r2: 301, c2: 1 }, { r1: 300, c1: 1, r2: 304, c2: 1 });
    expect(wb.getValue(id, 304, 1)).toBe(5);
    expect(wb.getCell(id, 304, 1).s).toMatchObject({ fmt: 'currency', bg: '#ffeeee' });
    expect(wb.getDisplay(id, 304, 1)).toBe('$5.00');
  });

  it('so a cell copied out of the column arrives formatted where it is pasted', () => {
    const { wb, id } = book();
    wb.pasteValues(id, [['20']], 310, 1);
    const copied = wb.copyRange(id, { r1: 310, c1: 1, r2: 310, c2: 1 });
    wb.pasteCells(id, copied, 310, 4, { r: 310, c: 1 });
    expect(wb.getDisplay(id, 310, 4)).toBe('$20.00');
  });

  it('leaves a sheet without any whole-line format writing exactly what it was given', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.pasteCells(id, [[{ v: 20, f: null }]], 3, 1, { r: 0, c: 0 });
    expect(wb.getCell(id, 3, 1).s).toBeUndefined();
    wb.setCells(id, [{ r: 5, c: 1, cell: { v: 1, f: null } }], 'Import');
    wb.fill(id, { r1: 5, c1: 1, r2: 5, c2: 1 }, { r1: 5, c1: 1, r2: 7, c2: 1 });
    expect(wb.getCell(id, 7, 1).s).toBeUndefined();
  });
});

describe('a paste from another program into a formatted column', () => {
  let view;
  function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  }
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
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

  it('keeps column formats for plain text and replaces them for HTML tables', async () => {
    const doc = new Doc({ name: 'Prices', path: 'Spreadsheets/Prices.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    const name = wb.sheet(id).name;
    wb.applyStyle(id, wholeCol(wb, id, 1), { fmt: 'currency', cur: 'USD', dec: 2 });
    wb.ensureSize(id, 400, 26);
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const paste = (where, data) => {
      view.goTo(`${name}!${where}`);
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData() {}, files: [] } });
      viewport.dispatchEvent(e);
    };
    paste('B320', { 'text/plain': '12' });
    paste('B330', { 'text/html': '<table><tr><td>34</td></tr></table>' });
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getDisplay(id, 319, 1)).toBe('$12.00');
    expect(wb.getDisplay(id, 329, 1)).toBe('34');
    expect(wb.styleAt(id, 329, 1)).toMatchObject({ fmt: null, cur: null, dec: null });
  });
});
