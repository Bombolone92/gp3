// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// A browser focuses a clicked toolbar button, and the menu it opens hands the
// focus back to it when it closes. Sorting, shuffling, removing empty rows and
// deleting rows from the toolbar left the focus stranded there, so the arrow
// keys roamed the toolbar instead of the grid. Each command now returns the
// focus to the grid when it is done.
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

async function mount() {
  const doc = new Doc({ name: 'Focus', path: 'Spreadsheets/Focus.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  [['Name', 'Qty'], ['b', '2'], [null, null], ['a', '1'], ['c', '3']].forEach((row, r) => row.forEach((v, c) => { if (v != null) wb.setInput(id, r, c, v); }));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = 'A1:B5';
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, viewport: view.el.querySelector('.grid-viewport') };
}
const menuItem = (pattern) => [...document.querySelectorAll('.menu-item')].find((n) => pattern.test(n.querySelector('.menu-label')?.textContent || ''));
/** Click a toolbar button the way a browser does, focusing it, then pick an item from the menu it opens. */
async function fromToolbar(label, item) {
  const btn = [...view.el.querySelectorAll('.tb-btn')].find((b) => b.getAttribute('aria-label') === label);
  btn.focus();
  btn.click();
  menuItem(item).click();
  await vi.advanceTimersByTimeAsync(1);
}

it.each([
  ['Sort & Filter', /^Sort A to Z$/],
  ['Sort & Filter', /^Randomize range$/],
  ['Sort & Filter', /^Remove empty rows$/],
])('returns the focus to the grid after %s > %s from the toolbar', async (label, item) => {
  const { viewport } = await mount();
  await fromToolbar(label, item);
  expect(document.activeElement).toBe(viewport);
});
