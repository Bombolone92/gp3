// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as modal from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// In focus mode "Go to" asks for the address in a dialog, but only cell and
// range addresses were understood: the names, tables and Sheet!A1 targets the
// name box accepts were turned down as "not a cell, range, or name".
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

async function goTo(text) {
  vi.spyOn(modal, 'promptDialog').mockResolvedValueOnce(text);
  view.el.querySelector('.grid-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(10);
}
const active = () => view.el.querySelector('.grid-viewport').getAttribute('aria-activedescendant');

it('goes to named ranges, tables and other sheets from the focus-mode dialog', async () => {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  const second = wb.addSheet('Second').id;
  wb.setActiveSheet(id);
  wb.defineName('Total', 'Sheet1!$C$5');
  wb.setInput(id, 9, 0, 'Item');
  wb.setInput(id, 9, 1, 'Amount');
  wb.setInput(id, 10, 0, 'Tape');
  wb.setInput(id, 10, 1, '4');
  wb.addTable(id, { r1: 9, c1: 0, r2: 10, c2: 1 }, { name: 'Stock' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  view.el.classList.add('focus-mode');
  await vi.advanceTimersByTimeAsync(1);
  const notify = vi.spyOn(notifications, 'toast');

  await goTo('Total');
  expect(active()).toBe('gc-4-2');
  await goTo('Stock');
  expect(active()).toBe('gc-9-0');
  await goTo('Second!B3');
  expect(wb.activeSheetId).toBe(second);
  expect(active()).toBe('gc-2-1');
  expect(notify.mock.calls.some(([message]) => /not a cell, range, or name/.test(message))).toBe(false);

  await goTo('Nowhere');
  expect(notify.mock.calls.some(([message]) => /not a cell, range, or name/.test(message))).toBe(true);
  expect(wb.activeSheetId).toBe(second);
  expect(active()).toBe('gc-2-1');
});
