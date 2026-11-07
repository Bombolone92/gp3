// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// A save that kept failing (offline, out of space) blocked every way out of
// the editor with a toast, although the local draft already held the edits.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), keys: () => [...m.keys()] };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  localStorage.clear();
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
const dialog = () => document.querySelector('.modal-root:not(.closing) .modal-panel[aria-label="Could not save"]');
const button = (label) => [...dialog().querySelectorAll('button')].find((b) => b.textContent === label);
const back = () => view.el.querySelector('[aria-label="Back to all spreadsheets"]').click();

it('offers to keep editing, retry, or leave with the edits kept in the local draft', async () => {
  const { doc, goHome, save } = setup();
  back();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialog()).not.toBeNull();
  expect(dialog().textContent).toContain('Offline');
  expect(dialog().textContent).toContain('kept in this browser');
  button('Keep editing').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialog()).toBeNull();
  expect(goHome).not.toHaveBeenCalled();
  const grid = view.el.querySelector('[role="grid"]');
  expect(grid.contains(document.activeElement) || document.activeElement === grid).toBe(true);

  back();
  await vi.advanceTimersByTimeAsync(1);
  button('Retry').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(3);
  expect(dialog()).not.toBeNull();
  button('Leave').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(goHome).toHaveBeenCalledOnce();
  expect(doc.wb.dirty).toBe(true);
  expect(localStorage.keys().some((key) => key.includes('Budget'))).toBe(true);
  // The router flushes once more on the way out; the answer stands.
  expect(await view.flush()).toBe(true);
  expect(dialog()).toBeNull();
  // A new edit makes the question worth asking again.
  doc.wb.setInput(doc.wb.activeSheetId, 1, 0, 'more');
  const asking = view.flush();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialog()).not.toBeNull();
  button('Keep editing').click();
  expect(await asking).toBe(false);
});

it('warns when this browser could not keep a copy either', async () => {
  const { doc } = setup();
  vi.spyOn(doc, 'writeDraft').mockReturnValue(false);
  back();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialog().textContent).toContain('could not keep a copy');
  expect(button('Leave without saving').classList.contains('btn-danger')).toBe(true);
});

it('only reports the failure when the save serves an operation rather than a departure', async () => {
  const { doc } = setup();
  const notify = vi.spyOn(notifications, 'toast');
  const pending = [];
  window.dispatchEvent(new CustomEvent('app:before-signout', { detail: { waitUntil: (p) => pending.push(p) } }));
  expect(await pending[0]).toBe(false);
  expect(dialog()).toBeNull();
  expect(notify.mock.calls.some(([message]) => message.startsWith('Could not save to Puter'))).toBe(true);
  expect(doc.wb.dirty).toBe(true);
});
