// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as modal from '../src/ui/modal.js';

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

// In focus mode the formula bar is hidden, so "Go to" had nothing to focus and silently did nothing.
it('asks for the address in focus mode and goes there', async () => {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  view.el.classList.add('focus-mode');
  const prompt = vi.spyOn(modal, 'promptDialog').mockResolvedValue('C5');
  view.el.querySelector('.grid-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(10);
  expect(prompt).toHaveBeenCalled();
  expect(view.el.querySelector('.grid [aria-activedescendant]')?.getAttribute('aria-activedescendant') ?? view.el.querySelector('.sel-active')?.id ?? document.getElementById('gc-4-2')?.className).toBeTruthy();
  expect(document.getElementById('gc-4-2')?.classList.contains('active') || view.el.querySelector('[aria-activedescendant="gc-4-2"]')).toBeTruthy();
});
