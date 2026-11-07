// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Data > Sort > Sort range A to Z decided for itself whether the first row was a header, with a rule
// spelt beside the one the Sort range… dialog offers as its default. Both now read the shared rule: a
// range expanded from a cell or whole columns keeps any header-like row, while an explicit selection
// keeps its first row only when that text row sits over typed values, so a plain list sorts whole.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

/** Column A holds `texts`; the editor selects `where` and runs Sort range A to Z from the Data menu. */
async function sorted(texts, where) {
  const doc = new Doc({ name: 'Sort', path: 'Spreadsheets/Sort.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  texts.forEach((t, r) => wb.setInput(id, r, 0, t));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${where}`);
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="data"]').click();
  item('Sort').click();
  await vi.advanceTimersByTimeAsync(1);
  item('Sort range A to Z').click();
  await vi.advanceTimersByTimeAsync(1);
  const out = texts.map((_, r) => wb.getValue(id, r, 0));
  view.destroy();
  view = null;
  return out;
}

it('keeps a text row over typed values as the header of an explicit selection', async () => {
  expect(await sorted(['Qty', '3', '1', '2'], 'A1:A4')).toEqual(['Qty', 1, 2, 3]);
});

it('sorts a plain list of text whole when it is selected explicitly', async () => {
  expect(await sorted(['Name', 'c', 'a', 'b'], 'A1:A4')).toEqual(['a', 'b', 'c', 'Name']);
});

it('keeps a header-like first row when the range grows from one cell or whole columns', async () => {
  expect(await sorted(['Name', 'c', 'a', 'b'], 'A2')).toEqual(['Name', 'a', 'b', 'c']);
  expect(await sorted(['Name', 'c', 'a', 'b'], 'A:A')).toEqual(['Name', 'a', 'b', 'c']);
});
