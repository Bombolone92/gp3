// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Edit > Select all took the whole sheet at once while Ctrl/Cmd+A steps: the block of data around the
// active cell first, the whole sheet on a second press. The menu now goes through the grid's own
// select-all, so a press of either moves the selection the same way.
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

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

/** A1:B2 hold data; nothing else does. */
async function setup() {
  const doc = new Doc({ name: 'All', path: 'Spreadsheets/All.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  [['a', 'b'], ['c', 'd']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  const status = () => view.el.querySelector('.status-left .status-item').textContent;
  const goTo = async (where) => { view.goTo(`Sheet1!${where}`); await vi.advanceTimersByTimeAsync(1); };
  const ctrlA = async () => { viewport.focus(); viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true })); await vi.advanceTimersByTimeAsync(1); };
  const menuSelectAll = async () => {
    view.el.querySelector('[data-menu="edit"]').click();
    item('Select').click();
    await vi.advanceTimersByTimeAsync(1);
    item('All').click();
    await vi.advanceTimersByTimeAsync(1);
  };
  return { wb, id, status, goTo, ctrlA, menuSelectAll };
}

it('moves the selection exactly as Ctrl/Cmd+A does, press for press', async () => {
  const { status, goTo, ctrlA, menuSelectAll } = await setup();
  await goTo('A1');
  await ctrlA();
  const afterOneKey = status();
  await ctrlA();
  const afterTwoKeys = status();
  expect(afterTwoKeys.startsWith('A1:')).toBe(true); // the second press reaches the whole sheet

  await goTo('A1');
  await menuSelectAll();
  expect(status()).toBe(afterOneKey);
  await menuSelectAll();
  expect(status()).toBe(afterTwoKeys);
});

it('takes the whole sheet from a cell with no data around it, as the key does', async () => {
  const { status, goTo, ctrlA, menuSelectAll } = await setup();
  await goTo('E9');
  await ctrlA();
  const byKey = status();
  await goTo('E9');
  await menuSelectAll();
  expect(status()).toBe(byKey);
  expect(byKey.startsWith('A1:')).toBe(true);
});
