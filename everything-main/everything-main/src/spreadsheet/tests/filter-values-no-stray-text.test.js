// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { isMenuOpen } from '../src/ui/menu.js';

// The value checklist in a column's filter menu ended with the word "false"
// whenever the column had values: the "No matches" placeholder was written as
// `!shown.length && el(...)`, and replaceChildren renders a bare false as text.
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

async function mount() {
  const doc = new Doc({ name: 'List', path: 'Spreadsheets/List.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  for (let r = 1; r <= 4; r++) wb.setInput(id, r, 0, String(r * 10));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(isMenuOpen()).toBe(true);
}

it('lists only the column values, with no stray text after them', async () => {
  await mount();
  const list = document.querySelector('.menu .filter-values');
  expect([...list.querySelectorAll('.filter-value-text')].map((n) => n.textContent)).toEqual(['10', '20', '30', '40']);
  expect([...list.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toEqual([]);
  expect(list.textContent).not.toContain('false');
});

it('shows "No matches" only when the search leaves nothing to list', async () => {
  await mount();
  const list = document.querySelector('.menu .filter-values');
  const search = document.querySelector('.menu [aria-label="Search values"]');
  search.value = '2';
  search.dispatchEvent(new Event('input'));
  expect([...list.querySelectorAll('.filter-value-text')].map((n) => n.textContent)).toEqual(['20']);
  expect(list.querySelector('.menu-header')).toBeNull();
  search.value = 'zzz';
  search.dispatchEvent(new Event('input'));
  expect(list.querySelectorAll('.filter-value')).toHaveLength(0);
  expect(list.querySelector('.menu-header')?.textContent).toBe('No matches');
});
