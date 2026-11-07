// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Every listener the editor puts on the workbook's change event must come off
// when the editor is destroyed; the one that ends a cut on any change stayed
// behind, reaching into a grid that was gone.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

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
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('removes every change listener it added to the workbook when destroyed', async () => {
  const doc = new Doc({ name: 'Leak', path: 'Spreadsheets/Leak.xlsx' });
  const { wb } = doc;
  const added = new Set();
  const removed = new Set();
  const realAdd = wb.addEventListener.bind(wb);
  const realRemove = wb.removeEventListener.bind(wb);
  vi.spyOn(wb, 'addEventListener').mockImplementation((type, fn, opts) => { if (type === 'change') added.add(fn); return realAdd(type, fn, opts); });
  vi.spyOn(wb, 'removeEventListener').mockImplementation((type, fn, opts) => { if (type === 'change') removed.add(fn); return realRemove(type, fn, opts); });
  const view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.destroy();
  const left = [...added].filter((fn) => !removed.has(fn));
  expect(left.map((fn) => fn.name || '(anonymous)')).toEqual([]);
});
