// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

// The editor's shortcut handler sits on its root, while dialogs and the command
// palette live in the body: Ctrl+S or Ctrl+P pressed inside them reached the
// browser, which opened its own save-page or print dialog over the app.
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

async function mount() {
  const doc = new Doc({ name: 'Keys', path: 'Spreadsheets/Keys.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return doc;
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const press = (target, key, init = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

it('swallows Ctrl+S and Ctrl+P inside a dialog so the browser does not open its own', async () => {
  const doc = await mount();
  const save = vi.spyOn(doc, 'save');
  view.el.querySelector('[data-menu="insert"]').click();
  menuItem('Note').click();
  await vi.advanceTimersByTimeAsync(1);
  const area = document.querySelector('.modal-panel[aria-label="Add note"] textarea');
  expect(area).toBeTruthy();
  expect(press(area, 's', { ctrlKey: true })).toBe(true);
  expect(press(area, 'p', { ctrlKey: true })).toBe(true);
  expect(press(area, 'P', { ctrlKey: true, shiftKey: true })).toBe(true);
  // Ordinary typing in the dialog is untouched, and so are the other chords.
  expect(press(area, 'a')).toBe(false);
  expect(press(area, 'a', { ctrlKey: true })).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(document.querySelector('.modal-panel[aria-label="Add note"]')).toBeTruthy();
});

it('swallows them in the command palette too, and stops once the editor is gone', async () => {
  await mount();
  view.el.querySelector('[aria-label="Search the menus"]').click();
  await vi.advanceTimersByTimeAsync(1);
  const input = document.querySelector('.palette input, .command-palette input, [role="combobox"]');
  expect(input).toBeTruthy();
  expect(press(input, 'p', { ctrlKey: true })).toBe(true);
  view.destroy();
  view = null;
  const stray = document.createElement('input');
  document.body.append(stray);
  expect(press(stray, 's', { ctrlKey: true })).toBe(false);
});
