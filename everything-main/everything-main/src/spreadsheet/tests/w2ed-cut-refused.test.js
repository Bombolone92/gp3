// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';
import { DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%

// A cut that takes part of a spilled array without its formula cannot move
// those values (they have no cell of their own), so the paste copies them.
// The editor did so silently, as though the move had happened.
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
  Element.prototype.setPointerCapture = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const clipboardEvent = (type) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: () => '', setData() {}, files: [] } });
  return e;
};

async function mount() {
  const doc = new Doc({ name: 'Cut', path: 'Spreadsheets/Cut.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3)');
  wb.getValue(id, 0, 0);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const toast = vi.spyOn(notifications, 'toast');
  const copiedInstead = () => toast.mock.calls.filter(([m]) => /Copied instead of moved/.test(m)).length;
  return { wb, id, viewport, copiedInstead };
}

it('says the paste copied the cut cells when they are part of an array without its formula', async () => {
  const { wb, id, viewport, copiedInstead } = await mount();
  view.goTo('Sheet1!A2:A3');
  viewport.dispatchEvent(clipboardEvent('cut'));
  view.goTo('Sheet1!C1');
  viewport.dispatchEvent(clipboardEvent('paste'));
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 1, 2)]).toEqual([2, 3]);
  expect([wb.getValue(id, 0, 0), wb.getValue(id, 1, 0), wb.getValue(id, 2, 0)]).toEqual([1, 2, 3]);
  expect(copiedInstead()).toBe(1);
  // The cut is over: the next paste is a plain copy, with nothing more to say.
  view.goTo('Sheet1!E1');
  viewport.dispatchEvent(clipboardEvent('paste'));
  expect([wb.getValue(id, 0, 4), wb.getValue(id, 1, 4)]).toEqual([2, 3]);
  expect(copiedInstead()).toBe(1);
});

it('says so for two separately selected cells of the array as well', async () => {
  const { wb, id, viewport, copiedInstead } = await mount();
  view.goTo('Sheet1!A2');
  // Ctrl+click adds A3: a multi-range cut moves its cells as one packed block.
  const pe = (type, x, y) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0, pointerType: 'mouse', ctrlKey: true, metaKey: true }));
  pe('pointerdown', 50, 2.5 * ROW); // the middle of A3
  pe('pointerup', 50, 2.5 * ROW);
  viewport.dispatchEvent(clipboardEvent('cut'));
  view.goTo('Sheet1!C1');
  viewport.dispatchEvent(clipboardEvent('paste'));
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 1, 2)]).toEqual([2, 3]);
  expect([wb.getValue(id, 0, 0), wb.getValue(id, 1, 0), wb.getValue(id, 2, 0)]).toEqual([1, 2, 3]);
  expect(copiedInstead()).toBe(1);
});

it('moves a cut that takes the whole array, formula included, without comment', async () => {
  const { wb, id, viewport, copiedInstead } = await mount();
  view.goTo('Sheet1!A1:A3');
  viewport.dispatchEvent(clipboardEvent('cut'));
  view.goTo('Sheet1!C1');
  viewport.dispatchEvent(clipboardEvent('paste'));
  expect(wb.getCell(id, 0, 2).f).toBe('SEQUENCE(3)');
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 2, 2), wb.getValue(id, 0, 0)]).toEqual([1, 3, null]);
  expect(copiedInstead()).toBe(0);
});
