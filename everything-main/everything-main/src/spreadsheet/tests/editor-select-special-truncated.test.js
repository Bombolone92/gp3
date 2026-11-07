// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// "Select cells of a kind" stops after the workbook's cap on blocks; the toast
// reported the partial count as if it were everything.
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
  const doc = new Doc({ name: 'Kinds', path: 'Spreadsheets/Kinds.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '2');
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, toast: vi.spyOn(notifications, 'toast') };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function selectNumbers() {
  view.el.querySelector('[data-menu="edit"]').click();
  menuItem('Select').click();
  menuItem('Numbers').click();
  await vi.advanceTimersByTimeAsync(1);
}

it('reports a complete selection as a plain count', async () => {
  const { toast } = await mount();
  await selectNumbers();
  expect(toast).toHaveBeenCalledWith('Selected 2 cells: numbers', expect.anything());
});

it('says the selection is only the first helping when the workbook stopped at its cap', async () => {
  const { wb, id, toast } = await mount();
  // Numbers in every other row of column B are a block each: with A1:A2 they pass the cap of 500 blocks.
  wb.transaction('Fill', () => { for (let r = 0; r <= 1000; r += 2) wb.setInput(id, r, 1, String(r)); });
  await selectNumbers();
  expect(toast).toHaveBeenCalledWith('Selected the first 501 cells: numbers (there are more)', expect.anything());
});
