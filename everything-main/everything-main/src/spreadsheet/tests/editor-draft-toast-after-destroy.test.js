// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// A recoverable draft is offered in a dialog; dismissed without a decision, a toast keeps Restore
// within reach for eight seconds. When the editor was left meanwhile (the router destroys the
// view, then closes the dialog), the toast appeared on the next screen and its Restore loaded the
// draft into the orphaned workbook and announced "Unsaved changes restored" with nothing shown or
// saved. Leaving the editor now dismisses the offer, and Restore does nothing after it.
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
  // The toast root is created once at import and must stay in the body: the app goes beside it, not in its place.
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
});
afterEach(() => {
  closeAllModals();
  view?.destroy();
  view = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll('#app, .toast, .modal-root').forEach((n) => n.remove());
});

function setup() {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  doc.recoverable = { savedAt: Date.now() - 60000, revision: 1, workbook: new Doc({ name: 'x' }).wb.toJSON() };
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  return doc;
}
const restoreButton = () => [...document.querySelectorAll('.toast:not(.leaving) .toast-action')].find((b) => b.textContent === 'Restore');

it('shows no kept-draft offer when the editor was left while the dialog was up', async () => {
  const doc = setup();
  const toast = vi.spyOn(notifications, 'toast');
  await vi.advanceTimersByTimeAsync(300);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  // The router leaves: the view goes first, then the open dialog is closed as dismissed.
  view.destroy();
  view = null;
  closeAllModals();
  await vi.advanceTimersByTimeAsync(50);
  expect(toast.mock.calls.some(([msg]) => /are kept until you restore/.test(msg))).toBe(false);
  expect(restoreButton()).toBeUndefined();
  expect(doc.recoverable).not.toBeNull(); // the draft is still offered on the next open
});

it('takes the offer away on leaving, and a Restore pressed in the same moment does nothing', async () => {
  const doc = setup();
  const restore = vi.spyOn(doc, 'restoreDraft');
  await vi.advanceTimersByTimeAsync(300);
  closeAllModals(); // dismissed without a decision
  await vi.advanceTimersByTimeAsync(50);
  const button = restoreButton();
  expect(button).toBeTruthy();
  const toast = vi.spyOn(notifications, 'toast');
  view.destroy();
  view = null;
  expect(restoreButton()).toBeUndefined(); // dismissed with the editor
  button.click();
  await vi.advanceTimersByTimeAsync(50);
  expect(restore).not.toHaveBeenCalled();
  expect(toast.mock.calls.some(([msg]) => msg === 'Unsaved changes restored')).toBe(false);
  expect(doc.recoverable).not.toBeNull();
});

it('still restores the draft from the offer while the editor is open', async () => {
  const doc = setup();
  const restore = vi.spyOn(doc, 'restoreDraft');
  await vi.advanceTimersByTimeAsync(300);
  closeAllModals();
  await vi.advanceTimersByTimeAsync(50);
  restoreButton().click();
  await vi.advanceTimersByTimeAsync(50);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(doc.recoverable).toBeNull();
});
