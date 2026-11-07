// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The document title in the top bar is cut short with an ellipsis in a narrow
// window, and its tooltip only said "Rename": the full name was nowhere to read.
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

it('shows the whole document name in the title button’s tooltip, and follows a rename', async () => {
  const doc = new Doc({ name: 'Quarterly budget review 2026 (draft)', path: 'Spreadsheets/Quarterly budget review 2026 (draft).xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const title = view.el.querySelector('.doc-title');
  expect(title.textContent).toBe('Quarterly budget review 2026 (draft)');
  expect(title.title).toContain('Quarterly budget review 2026 (draft)');
  expect(title.title).toContain('Rename');
  doc.name = 'Budget';
  doc.dispatchEvent(new Event('path'));
  expect(title.textContent).toBe('Budget');
  expect(title.title).toContain('Budget');
  expect(title.title).not.toContain('Quarterly');
});
