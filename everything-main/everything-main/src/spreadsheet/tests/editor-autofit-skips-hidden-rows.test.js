// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Fit columns to content measured every cell of the column, including the rows a filter hides
// and the rows hidden by hand, so a long text out of sight widened the column for the cells on
// screen. It now sizes to the visible cells alone,
// from the Format menu, the palette and the column header's menu alike.
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
const LONG = 'x'.repeat(66);

async function mount() {
  const doc = new Doc({ name: 'Fit', path: 'Spreadsheets/Fit.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const [r, text] of [[0, 'Item'], [1, 'ab'], [2, 'cd'], [3, LONG]]) wb.setInput(id, r, 0, text);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1');
  await vi.advanceTimersByTimeAsync(1);
  const fit = async () => {
    view.el.querySelector('[data-menu="format"]').click();
    for (const label of ['Rows and columns', 'Fit columns to content']) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  return { wb, id, fit };
}

it('sizes the column to the rows a filter shows, not to a long text in a row it hides', async () => {
  const { wb, id, fit } = await mount();
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['ab', 'cd'] });
  expect(wb.isRowHidden(id, 3)).toBe(true);
  await fit();
  expect(wb.colWidth(id, 0)).toBeLessThan(100);
  // With the filter cleared the long text counts again.
  wb.clearFilter(id);
  await fit();
  expect(wb.colWidth(id, 0)).toBeGreaterThan(400);
});

it('leaves out the rows hidden by hand too', async () => {
  const { wb, id, fit } = await mount();
  wb.setHidden(id, 'row', [3], true);
  await fit();
  expect(wb.colWidth(id, 0)).toBeLessThan(100);
});
