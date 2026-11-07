// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';

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

// F9 re-read AI answers but kept IMPORTRANGE's parsed files for their 30-second lifetime,
// so "Recalculated" still showed stale imported data.
it('rereads IMPORTRANGE files on F9', async () => {
  let content = '42';
  const read = vi.spyOn(P, 'readFile').mockImplementation(async () => new TextEncoder().encode(content));
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  const wb = doc.wb, id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=IMPORTRANGE("Source.csv","A1")');
  wb.getValue(id, 0, 0);
  await vi.advanceTimersByTimeAsync(20);
  expect(wb.getValue(id, 0, 0)).toBe(42);
  content = '43';
  view.el.querySelector('.grid-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(50);
  wb.getValue(id, 0, 0);
  await vi.advanceTimersByTimeAsync(50);
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(wb.getValue(id, 0, 0)).toBe(43);
});
