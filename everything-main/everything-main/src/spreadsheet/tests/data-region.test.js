// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { cellName } from '../src/core/cell.js';

// Node ships a placeholder localStorage that jsdom does not replace; use a real in-memory one.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

/** A sheet with a title, a blank row, a header row and data, like the sample budget. */
function report() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Monthly budget');
  wb.setInput(id, 1, 0, 'Plan against what actually left the account.');
  const rows = [['Category', 'Planned', 'Actual'], ['Rent', '1500', '1500'], ['Groceries', '450', '423'], ['Utilities', '180', '173']];
  rows.forEach((row, i) => row.forEach((text, j) => wb.setInput(id, 3 + i, j, text)));
  wb.setInput(id, 8, 0, 'Income');
  wb.setInput(id, 8, 1, '4200');
  wb.clearHistory();
  return { wb, id };
}

it('finds the block of data around a cell, bounded by empty rows and columns', () => {
  const { wb, id } = report();
  const table = { r1: 3, c1: 0, r2: 6, c2: 2 };
  expect(wb.dataRegion(id, 3, 0)).toEqual(table);
  expect(wb.dataRegion(id, 5, 2)).toEqual(table);
  expect(wb.dataRegion(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
  expect(wb.dataRegion(id, 8, 1)).toEqual({ r1: 8, c1: 0, r2: 8, c2: 1 });
});

it('reaches through diagonal neighbours and trims empty edges around a blank starting cell', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'a');
  wb.setInput(id, 1, 1, 'b');
  wb.setInput(id, 2, 2, 'c');
  expect(wb.dataRegion(id, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  // A blank cell touching the block belongs to it.
  expect(wb.dataRegion(id, 0, 1)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  // A blank cell with nothing beside it has no region, even next to the block's bounding box.
  expect(wb.dataRegion(id, 0, 3)).toBeNull();
  expect(wb.dataRegion(id, 4, 4)).toBeNull();
  expect(wb.dataRegion(id, 10, 10)).toBeNull();
  // Starting from a blank cell beside a block reports the data itself, not the blank edge.
  const filled = new Workbook();
  const fid = filled.activeSheetId;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) filled.setInput(fid, r, c, `${r}${c}`);
  expect(filled.dataRegion(fid, 1, 2)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
  expect(filled.dataRegion(fid, 3, 0)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
});

it('counts spilled array results as data', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(5)');
  wb.setInput(id, 0, 1, 'x');
  expect(wb.dataRegion(id, 4, 0)).toEqual({ r1: 0, c1: 0, r2: 4, c2: 1 });
  expect(wb.dataRegion(id, 6, 0)).toBeNull();
});

it('handles a tall block', () => {
  const wb = new Workbook({ sheets: [{ name: 'Big', rows: 25000, cols: 12, cells: Object.fromEntries(
    Array.from({ length: 20000 }, (_, r) => Array.from({ length: 8 }, (_, c) => [`${r},${c}`, { v: r * 8 + c }])).flat(),
  ) }] });
  const id = wb.activeSheetId;
  expect(wb.dataRegion(id, 10000, 3)).toEqual({ r1: 0, c1: 0, r2: 19999, c2: 7 });
  expect(wb.dataRegion(id, 20000, 3)).toEqual({ r1: 0, c1: 0, r2: 19999, c2: 7 });
});

describe('single-cell data commands', () => {
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

  async function open(active) {
    const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
    const { id } = seed(doc.wb);
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.goTo(`Sheet1!${cellName(active.r, active.c)}`);
    await vi.advanceTimersByTimeAsync(1);
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((node) => node.querySelector('.menu-label')?.textContent === label);
    return { wb: doc.wb, id, item };
  }
  function seed(wb) {
    const id = wb.activeSheetId;
    const other = report();
    wb.replaceWith(other.wb.toJSON());
    wb.clearHistory();
    return { id: wb.activeSheetId };
  }

  it('puts a filter on the header row of the block around the cell, not on the title row', async () => {
    const { wb, id, item } = await open({ r: 4, c: 1 });
    view.el.querySelector('[data-menu="data"]').click();
    item('Filter').click();
    expect(wb.sheet(id).filter?.range).toEqual({ r1: 3, c1: 0, r2: 6, c2: 2 });
  });

  it('charts the block around the cell', async () => {
    const { wb, id, item } = await open({ r: 5, c: 2 });
    view.el.querySelector('[data-menu="insert"]').click();
    item('Chart…').click();
    await vi.advanceTimersByTimeAsync(1);
    // The Insert Chart dialog: OK inserts the chart picked, over the data around the active cell.
    document.querySelector('.modal-panel form').requestSubmit();
    await vi.advanceTimersByTimeAsync(5);
    expect(wb.sheet(id).charts.at(-1)?.range).toEqual({ r1: 3, c1: 0, r2: 6, c2: 2 });
  });

  it('falls back to the used range from an empty, isolated cell', async () => {
    const { wb, id, item } = await open({ r: 12, c: 6 });
    view.el.querySelector('[data-menu="data"]').click();
    item('Filter').click();
    expect(wb.sheet(id).filter?.range).toEqual({ r1: 0, c1: 0, r2: 8, c2: 2 });
  });
});
