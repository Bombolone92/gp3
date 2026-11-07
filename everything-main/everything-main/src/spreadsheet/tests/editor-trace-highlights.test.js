// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The precedent and dependent highlights are not kept per sheet, yet they
// stayed on screen after switching to another sheet, marking unrelated cells
// there, and after rows were inserted, marking the wrong ones.
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
  const doc = new Doc({ name: 'Trace', path: 'Spreadsheets/Trace.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '=A1*2');
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = 'A2';
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function showPrecedents() {
  view.el.querySelector('[data-menu="tools"]').click();
  menuItem('Show precedents').click();
  await vi.advanceTimersByTimeAsync(1);
}
const highlights = () => view.el.querySelectorAll('.find-hl').length;

it('clears the highlights when another sheet is shown', async () => {
  const { wb, id } = await mount();
  await showPrecedents();
  expect(highlights()).toBe(1);
  const other = wb.addSheet('Two');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.activeSheetId).toBe(other.id);
  expect(highlights()).toBe(0);
  wb.setActiveSheet(id);
  await vi.advanceTimersByTimeAsync(1);
  expect(highlights()).toBe(0);
});

it('clears the highlights when rows are inserted, since the cells they marked have moved', async () => {
  const { wb, id } = await mount();
  await showPrecedents();
  expect(highlights()).toBe(1);
  wb.insertRows(id, 0, 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(highlights()).toBe(0);
});

it('keeps the highlights while the same sheet is edited', async () => {
  const { wb, id } = await mount();
  await showPrecedents();
  wb.setInput(id, 3, 3, 'note to self');
  await vi.advanceTimersByTimeAsync(1);
  expect(highlights()).toBe(1);
});
