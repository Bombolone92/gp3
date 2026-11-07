// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// The two buttons that open the function menu said nothing about opening one,
// so the menu's expanded state had nothing to hang on and assistive technology
// heard a plain button.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('marks the formula bar’s fx button and the toolbar’s Insert function button as menu openers', async () => {
  const doc = new Doc({ name: 'Fx', path: 'Spreadsheets/Fx.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const fx = view.el.querySelector('.fx-btn');
  const fn = view.el.querySelector('.tb-btn[data-cmd="functionMenu"]');
  expect(fx.getAttribute('aria-haspopup')).toBe('menu');
  expect(fn.getAttribute('aria-haspopup')).toBe('menu');
  fx.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('.menu[aria-label="Insert function"]')).toBeTruthy();
  expect(fx.getAttribute('aria-expanded')).toBe('true');
  closeMenu();
  expect(fx.getAttribute('aria-expanded')).toBe('false');
});
