// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { buildPrintTable } from '../src/ui/print.js';
import { summarize } from '../src/ui/statusbar.js';

// A format given to a whole column lives on the column, so a cell far below the stored ones carries
// nothing of its own. The toolbar read the cell's own style alone, so standing on such a cell it said
// "Automatic" and left Bold unpressed for a column that is formatted and bold. It reports what the
// cell shows now, the column's and row's defaults included.
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (t) => ({ width: t.length * 7 }) });
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

it('reports the format a cell in a formatted column is in, wherever the cursor stands in it', async () => {
  const doc = new Doc({ name: 'Prices', path: 'Spreadsheets/Prices.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  const name = wb.sheet(id).name;
  wb.applyStyle(id, { r1: 0, c1: 1, r2: wb.sheet(id).rows - 1, c2: 1 }, { fmt: 'currency', cur: 'USD', dec: 2, bold: true });
  wb.ensureSize(id, 400, 26);
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const label = () => view.el.querySelector('.tb-fmt-label').textContent;
  const bold = () => view.el.querySelector('[data-cmd="bold"]').getAttribute('aria-pressed');
  view.goTo(`${name}!B300`);
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 299, 1)).toBeUndefined(); // the column keeps the format; the cell stores nothing
  expect(label()).toBe('Currency');
  expect(bold()).toBe('true');
  view.el.querySelector('[data-cmd="bold"]').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(bold()).toBe('false');
  expect(wb.styleAt(id, 299, 1)?.bold).toBeFalsy();
  expect(label()).toBe('Currency');
  view.goTo(`${name}!B301`);
  await vi.advanceTimersByTimeAsync(1);
  expect(bold()).toBe('true');
  // And the column beside it still reads as the plain cell it is.
  view.goTo(`${name}!C300`);
  await vi.advanceTimersByTimeAsync(1);
  expect(label()).toBe('General');
  expect(bold()).toBe('false');
});

it('clears inherited formatting through the toolbar and refreshes the grid, chart, summary and print output', async () => {
  const doc = new Doc({ name: 'Clear', path: 'Spreadsheets/Clear.xlsx' });
  const wb = doc.wb, id = wb.activeSheetId;
  // Values loaded after line formatting have no own styles, so clearing them changes only the sparse exceptions.
  wb.sheet(id).colStyles.set(1, { fmt: 'currency', cur: 'USD', bold: true, bg: '#ffff00' });
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'Item' } }, { r: 0, c: 1, cell: { v: 'Amount' } },
    { r: 1, c: 0, cell: { v: 'A' } }, { r: 1, c: 1, cell: { v: 12 } },
    { r: 2, c: 0, cell: { v: 'B' } }, { r: 2, c: 1, cell: { v: 24 } },
  ]);
  wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 2, c2: 1 }, anchor: { r: 5, c: 3 }, w: 300, h: 200 });
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(10);
  view.goTo('B2:B3');
  await vi.advanceTimersByTimeAsync(10);
  const cell = () => view.el.querySelector('.cell[data-r="1"][data-c="1"]');
  const chart = () => view.el.querySelector('.chart-box svg');
  expect(cell().textContent).toContain('$12.00');
  const before = chart();
  expect(before.textContent).toContain('$');
  // Home ▸ Clear ▸ Clear Formats.
  view.el.querySelector('.ribbon-home button[aria-label="Clear"]').click();
  [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === 'Clear Formats').click();
  await vi.advanceTimersByTimeAsync(10);
  expect(view.el.querySelector('.tb-fmt-label').textContent).toBe('General');
  expect(view.el.querySelector('[data-cmd="bold"]').getAttribute('aria-pressed')).toBe('false');
  expect(cell().textContent).toBe('12');
  expect(cell().style.backgroundColor).not.toBe('rgb(255, 255, 0)');
  expect(chart()).not.toBe(before);
  expect(chart().textContent).not.toContain('$');
  expect(summarize(wb, id, { r1: 1, c1: 1, r2: 2, c2: 1 })).not.toHaveProperty('style');
  const printed = buildPrintTable(wb, id);
  expect(printed.textContent).not.toContain('$');
  expect(printed.querySelector('tbody tr:nth-child(2) td:nth-child(2)').style.backgroundColor).not.toBe('rgb(255, 255, 0)');
  wb.undo();
  await vi.advanceTimersByTimeAsync(10);
  expect(cell().textContent).toContain('$12.00');
  expect(chart().textContent).toContain('$');
});
