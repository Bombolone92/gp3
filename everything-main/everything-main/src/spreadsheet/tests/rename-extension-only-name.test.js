// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';
import * as modal from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// The file is always saved as .xlsx, so a name of only ".xlsx" leaves no name. Rename and Save a copy
// accepted it, closed, and only then reported "Enter a name" in a toast; the dialog now refuses it in place.
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

function mount(path) {
  const doc = new Doc({ name: 'Budget', path });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  return doc;
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const fileMenu = (label) => { view.el.querySelector('[data-menu="file"]').click(); menuItem(label).click(); };
const leave = () => { view.destroy(); view = null; };
const appInert = () => document.getElementById('app').hasAttribute('inert');

for (const [item, title, method] of [['Rename…', 'Rename spreadsheet', 'rename'], ['Save a copy…', 'Save a copy', 'saveAs']]) {
  it(`${title} refuses a name that is only the .xlsx extension, in the dialog`, async () => {
    const doc = mount('Spreadsheets/Budget.xlsx');
    const call = vi.spyOn(doc, method).mockResolvedValue(null);
    fileMenu(item);
    await vi.advanceTimersByTimeAsync(1);
    const panel = document.querySelector(`.modal-panel[aria-label="${title}"]`);
    const input = panel.querySelector('input');
    input.value = ' .XLSX ';
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(call).not.toHaveBeenCalled();
    expect(panel.isConnected).toBe(true);
    expect(panel.querySelector('.field-error').hidden).toBe(false);
    expect(panel.querySelector('.field-error').textContent).toBe('Enter a name');
    input.value = 'Plan.xlsx';
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledWith('Plan.xlsx');
  });
}
