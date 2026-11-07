// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

// A flush that started while another was waiting on its "Could not save"
// dialog saved again and stacked a second dialog over the first. The router
// flushes on every hash change, so leaving twice in a row did exactly that.
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
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  const goHome = vi.fn();
  view = editorView({ doc, goHome, openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Unsaved work');
  const save = vi.spyOn(doc, 'save').mockRejectedValue(new Error('Offline'));
  return { doc, goHome, save };
}
const dialogs = () => document.querySelectorAll('.modal-root:not(.closing) .modal-panel[aria-label="Could not save"]');
const button = (label) => [...dialogs()[0].querySelectorAll('button')].find((b) => b.textContent === label);

it('shows one Could not save dialog when a second flush starts while the first waits on it, and answers both', async () => {
  const { save } = setup();
  const first = view.flush();
  const second = view.flush();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialogs()).toHaveLength(1);
  expect(save).toHaveBeenCalledTimes(1);
  button('Leave').click();
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(dialogs()).toHaveLength(0);
});

it('asks again once the earlier flush has been answered', async () => {
  const { save } = setup();
  const first = view.flush();
  await vi.advanceTimersByTimeAsync(1);
  button('Keep editing').click();
  expect(await first).toBe(false);
  const again = view.flush();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialogs()).toHaveLength(1);
  expect(save).toHaveBeenCalledTimes(2);
  button('Keep editing').click();
  expect(await again).toBe(false);
});
