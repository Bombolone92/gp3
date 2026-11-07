// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// A name typed into the name box over a Ctrl/Cmd+click selection of several ranges named the
// last range alone (A1:A2 and C1 became Pair = $C$1) without a word, while A1:A2 stayed
// highlighted as selected. A name here holds one reference, so the box says to select one range.
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
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function open() {
  const doc = new Doc({ name: 'Names', path: 'Spreadsheets/Names.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  const pe = (type, r, c, init = {}) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: c * 100 + 50, clientY: r * 26 + 13, pointerId: 7, button: 0, pointerType: 'mouse', ...init }));
  const select = async (first, ...more) => {
    view.goTo(`Sheet1!${first}`);
    await vi.advanceTimersByTimeAsync(1);
    for (const rg of more) {
      pe('pointerdown', rg.r1, rg.c1, { ctrlKey: true, metaKey: true });
      if (rg.r2 !== rg.r1 || rg.c2 !== rg.c1) pe('pointermove', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
      pe('pointerup', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(view.el.querySelector('.status-left .status-item').textContent.split(', ')).toHaveLength(more.length + 1);
  };
  const nameBox = view.el.querySelector('.name-box');
  const nameIt = async (text) => {
    nameBox.focus();
    nameBox.value = text;
    nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
  };
  const toast = vi.spyOn(notifications, 'toast');
  return { wb, id, select, nameBox, nameIt, toast };
}

it('refuses to name a selection of several ranges, and keeps the name in the box', async () => {
  const { wb, select, nameBox, nameIt, toast } = await open();
  await select('A1:A2', { r1: 0, c1: 2, r2: 0, c2: 2 });
  await nameIt('Pair');
  expect(wb.names).toEqual([]);
  expect(toast).toHaveBeenCalledWith('Select one range to name it', expect.anything());
  expect(document.activeElement).toBe(nameBox);
  expect(nameBox.value).toBe('Pair');
});

it('names a single range as before', async () => {
  const { wb, select, nameIt } = await open();
  await select('A1:A2');
  await nameIt('Pair');
  expect(wb.names).toEqual([{ name: 'Pair', ref: 'Sheet1!$A$1:$A$2' }]);
});
