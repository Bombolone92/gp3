// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

// Named ranges was the one dialog command that opened over a live in-cell edit, so its "Go to range"
// and "Edit table" actions moved the selection and opened another dialog under the still-open cell
// editor. It now commits the edit first, like every neighbouring dialog command.
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
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

it('commits the open cell edit before the Named ranges dialog opens', async () => {
  const doc = new Doc({ name: 'Names', path: 'Spreadsheets/Names.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '10');
  wb.setInput(id, 2, 1, '20');
  wb.defineName('Sales', 'Sheet1!$B$2:$B$3');
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1');
  await vi.advanceTimersByTimeAsync(1);
  // Start typing into A1 and leave the editor open.
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', bubbles: true, cancelable: true }));
  const editor = view.el.querySelector('.grid-editor');
  editor.value = 'Total';
  editor.setSelectionRange(5, 5);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(editor.hidden).toBe(false);
  view.el.querySelector('[data-menu="data"]').click();
  item('Named ranges…').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('.modal-panel')).not.toBeNull();
  expect(editor.hidden).toBe(true);
  expect(wb.getValue(id, 0, 0)).toBe('Total');
  // Its actions then act on the committed sheet: jumping to a name selects it with no editor in the way.
  document.querySelector('.modal-panel .names-main').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(view.el.querySelector('[aria-label="Cell reference"]').value).toBe('Sales');
  expect(editor.hidden).toBe(true);
  expect(wb.getValue(id, 0, 0)).toBe('Total');
});
