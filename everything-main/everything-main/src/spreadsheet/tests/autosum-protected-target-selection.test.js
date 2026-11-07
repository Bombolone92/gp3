// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// AutoSum (Alt+=) into a protected cell, and Insert function beside a selected range whose landing
// cell is protected, had the write refused by the workbook and then moved the selection on as though
// the formula had been entered. The selection now stays where it was.
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

const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

/** A1:A3 hold 1, 2, 3; A4 (where a sum would land) is protected unless `protect` is false. */
async function mount({ protect = true } = {}) {
  const doc = new Doc({ name: 'Sums', path: 'Spreadsheets/Sums.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
  if (protect) wb.protectRange(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, 'total');
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const select = async (where) => { view.goTo(`Sheet1!${where}`); await vi.advanceTimersByTimeAsync(1); };
  const viewport = view.el.querySelector('.grid-viewport');
  const altEquals = async () => { viewport.focus(); viewport.dispatchEvent(new KeyboardEvent('keydown', { key: '=', altKey: true, bubbles: true, cancelable: true })); await vi.advanceTimersByTimeAsync(1); };
  const insertFunctionAutoSum = async () => {
    view.el.querySelector('[data-menu="insert"]').click();
    menuItem('Function').click();
    menuItem('AutoSum').click();
    await vi.advanceTimersByTimeAsync(1);
  };
  const selection = () => view.el.querySelector('.status-left .status-item').textContent;
  const active = () => viewport.getAttribute('aria-activedescendant');
  return { wb, id, toast, select, altEquals, insertFunctionAutoSum, selection, active };
}

it('keeps the selection on a protected cell AutoSum could not write into', async () => {
  const { wb, id, toast, select, altEquals, active } = await mount();
  await select('A4');
  await altEquals();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A4 is protected/), expect.objectContaining({ icon: 'lock' }));
  expect(wb.getCell(id, 3, 0)?.f ?? null).toBeNull();
  expect(active()).toBe('gc-3-0');
  expect(view.el.querySelector('.grid-editor').hidden).toBe(true); // no editor opened either
  expect(wb.canUndo()).toBe(false);
});

it('keeps the selected range when the cell beside it that Insert function would write to is protected', async () => {
  const { wb, id, toast, select, insertFunctionAutoSum, selection } = await mount();
  await select('A1:A3');
  await insertFunctionAutoSum();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A4 is protected/), expect.objectContaining({ icon: 'lock' }));
  expect(wb.getCell(id, 3, 0)?.f ?? null).toBeNull();
  expect(selection()).toBe('A1:A3');
  expect(wb.canUndo()).toBe(false);
});

it('still writes the sum and moves on when the cell is free', async () => {
  const { wb, id, select, altEquals, active } = await mount({ protect: false });
  await select('A4');
  await altEquals();
  expect(wb.getCell(id, 3, 0).f).toBe('SUM(A1:A3)');
  expect(wb.getValue(id, 3, 0)).toBe(6);
  expect(active()).toBe('gc-4-0');
});
