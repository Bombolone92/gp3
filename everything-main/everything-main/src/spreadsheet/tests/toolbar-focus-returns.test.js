// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// A browser focuses a clicked toolbar button. The commands behind Undo, Redo and Filter returned
// without putting focus back on the grid, so the next arrow key roamed the toolbar instead of moving
// the active cell; Bold and the rest already came back to the grid.
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

async function open() {
  const doc = new Doc({ name: 'Focus', path: 'Spreadsheets/Focus.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  [['Name', 'Qty'], ['a', '1'], ['b', '2']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  /** Click a toolbar button the way a browser does: it takes focus first. The toolbar has refreshed its buttons by then. */
  const click = async (cmd) => { await vi.advanceTimersByTimeAsync(5); const btn = view.el.querySelector(`.tb-btn[data-cmd="${cmd}"]`); expect(btn.disabled).toBe(false); btn.focus(); btn.click(); };
  return { wb, id, viewport, click };
}

it('puts focus back on the grid after the toolbar Undo, Redo and Filter buttons', async () => {
  const { wb, viewport, click } = await open();
  expect(wb.canUndo()).toBe(true);
  await click('undo');
  expect(document.activeElement).toBe(viewport);
  await click('redo');
  expect(document.activeElement).toBe(viewport);
  await click('filter');
  expect(wb.sheet(wb.activeSheetId).filter).not.toBeNull();
  expect(document.activeElement).toBe(viewport);
  await click('filter');
  expect(wb.sheet(wb.activeSheetId).filter).toBeNull();
  expect(document.activeElement).toBe(viewport);
});
