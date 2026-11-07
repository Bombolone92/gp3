// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// The workbook refuses to move cut cells onto part of a merged block, and the
// editor dropped the refusal in silence: nothing moved, nothing said, the cut still armed. The
// refusal is now announced, as the other cut and paste refusals are.
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

const clipboardEvent = (type) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { setData() {}, getData: () => '', files: [] } });
  return e;
};

async function mount() {
  const doc = new Doc({ name: 'Cut', path: 'Spreadsheets/Cut.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '2');
  wb.mergeCells(id, { r1: 0, c1: 2, r2: 0, c2: 3 }); // C1:D1
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const toast = vi.spyOn(notifications, 'toast');
  const refusals = () => toast.mock.calls.filter(([m]) => /cannot be moved onto part of a merged cell/.test(m)).length;
  const column = (c) => [wb.getValue(id, 0, c), wb.getValue(id, 1, c)];
  return { wb, id, viewport, refusals, column };
}

it('says why when the cut cells would land on part of a merged block, and moves nothing', async () => {
  const { wb, id, viewport, refusals, column } = await mount();
  view.goTo('Sheet1!A1:A2');
  viewport.dispatchEvent(clipboardEvent('cut'));
  view.goTo('Sheet1!C1');
  viewport.dispatchEvent(clipboardEvent('paste'));
  await vi.advanceTimersByTimeAsync(1);
  expect(refusals()).toBe(1);
  expect(column(0)).toEqual([1, 2]);
  expect(column(2)).toEqual([null, null]);
  expect(wb.mergesIn(id, { r1: 0, c1: 2, r2: 0, c2: 3 })).toHaveLength(1);
  expect(wb.undoLabels()).toEqual([]);
  // The cut is still armed: pasted clear of the merge, the cells move.
  view.goTo('Sheet1!F1');
  viewport.dispatchEvent(clipboardEvent('paste'));
  await vi.advanceTimersByTimeAsync(1);
  expect(column(5)).toEqual([1, 2]);
  expect(column(0)).toEqual([null, null]);
  expect(refusals()).toBe(1);
  expect(wb.undoLabels()).toEqual(['Move cells']);
});
