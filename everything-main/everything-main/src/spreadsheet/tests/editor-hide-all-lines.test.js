// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// Hiding rows or columns with the whole sheet selected did nothing and said
// nothing: the workbook refuses to hide every line, silently.
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
  const doc = new Doc({ name: 'Hide', path: 'Spreadsheets/Hide.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, toast: vi.spyOn(notifications, 'toast') };
}
async function select(text) {
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = text;
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function hide(label) {
  view.el.querySelector('[data-menu="view"]').click();
  menuItem('Hide and unhide').click();
  menuItem(label).click();
  await vi.advanceTimersByTimeAsync(1);
}

it('says that every row cannot be hidden when the whole sheet is selected', async () => {
  const { wb, id, toast } = await mount();
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  await hide('Hide rows');
  expect(wb.sheet(id).hiddenRows.size).toBe(0);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Every row cannot be hidden/), expect.objectContaining({ icon: 'info' }));
  await hide('Hide columns');
  expect(wb.sheet(id).hiddenCols.size).toBe(0);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Every column cannot be hidden/), expect.objectContaining({ icon: 'info' }));
});

it('hides a few rows quietly, as before', async () => {
  const { wb, id, toast } = await mount();
  await select('2:3');
  await hide('Hide rows');
  expect([...wb.sheet(id).hiddenRows].sort()).toEqual([1, 2]);
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/cannot be hidden/), expect.anything());
});
