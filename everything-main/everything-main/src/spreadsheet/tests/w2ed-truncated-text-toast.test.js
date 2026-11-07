// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { MAX_TEXT } from '../src/core/cell.js';
import * as notifications from '../src/ui/toast.js';

// A cell keeps no more text than an .xlsx file can store (32,767 characters).
// The workbook cuts a longer entry and says so with a change event; the editor
// turns that into a notice, once per cut, rather than dropping the tail quietly.
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

it('says the text was cut to the cell limit, once per entry that ran past it', async () => {
  const doc = new Doc({ name: 'Long', path: 'Spreadsheets/Long.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  wb.setInput(id, 0, 0, 'x'.repeat(MAX_TEXT + 5));
  expect(wb.getValue(id, 0, 0)).toHaveLength(MAX_TEXT);
  const cut = () => toast.mock.calls.filter(([m]) => /^Text cut to 32,767 characters/.test(m));
  expect(cut()).toHaveLength(1);
  expect(cut()[0][1]).toMatchObject({ icon: 'info' });
  // Text within the limit says nothing.
  wb.setInput(id, 1, 0, 'x'.repeat(MAX_TEXT));
  expect(cut()).toHaveLength(1);
  // A second entry past the limit is a second notice.
  wb.setInput(id, 2, 0, 'y'.repeat(MAX_TEXT + 1));
  expect(cut()).toHaveLength(2);
});
