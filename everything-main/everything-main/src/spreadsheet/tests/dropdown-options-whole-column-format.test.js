// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A dropdown of typed-in numbers reads in the format of the cell it is on. That was the cell's own
// style alone, so in a column formatted as Currency the cells showed $10.00 while the list beside
// them offered a bare 10. The list reads the format the cell shows now, its column's included.
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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('offers a list of amounts in the format the column gives its cells', async () => {
  const doc = new Doc({ name: 'Prices', path: 'Spreadsheets/Prices.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  const name = wb.sheet(id).name;
  wb.applyStyle(id, { r1: 0, c1: 1, r2: wb.sheet(id).rows - 1, c2: 1 }, { fmt: 'currency', cur: 'USD', dec: 2 });
  wb.ensureSize(id, 400, 26);
  // A list of typed numbers, the shape a file's inline dropdown arrives in: no source cell shows them.
  wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 399, c2: 1 }, type: 'list', source: [10, 20] });
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  view.goTo(`${name}!B300`); // far below the cells the sheet stored, so the cell carries no style of its own
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 299, 1)).toBeUndefined();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  const labels = [...document.querySelectorAll('.menu-item .menu-label')].map((node) => node.textContent);
  expect(labels).toEqual(['$10.00', '$20.00']);
});
