// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Change text and Split text to columns worked on the last range of a Ctrl+click
// selection alone, and rewrote the rows a filter hides. Like clearing or
// formatting, they now cover every selected range and only the rows shown, in
// one undo step.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount(rows, prep = null) {
  const doc = new Doc({ name: 'Text', path: 'Spreadsheets/Text.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  rows.forEach((row, r) => row.forEach((v, c) => { if (v != null) wb.setInput(id, r, c, String(v)); }));
  prep?.(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, column: (c, n = rows.length) => Array.from({ length: n }, (_, r) => wb.getValue(id, r, c)) };
}
async function select(text) {
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = text;
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
}
/** Ctrl+click the middle of cell (r, c): rows are 26px and columns 100px in the viewport's own coordinates. */
function ctrlClick(r, c) {
  const viewport = view.el.querySelector('.grid-viewport');
  for (const type of ['pointerdown', 'pointerup']) viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: c * 100 + 50, clientY: r * 26 + 13, pointerId: 7, button: 0, pointerType: 'mouse', ctrlKey: true, metaKey: true }));
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function cleanup(label) {
  view.el.querySelector('[data-menu="data"]').click();
  menuItem('Data cleanup').click();
  menuItem(label).click();
  await vi.advanceTimersByTimeAsync(1);
}

it('changes the case of every selected range in one undo step', async () => {
  const { wb, column } = await mount([['a', null, 'z'], ['b', null, 'y'], ['c', null, 'x']]);
  await select('A1:A2');
  ctrlClick(0, 2);
  await vi.advanceTimersByTimeAsync(1);
  expect(view.el.querySelectorAll('.sel-extras .sel-range.extra').length).toBe(1);
  await cleanup('UPPERCASE');
  expect(column(0)).toEqual(['A', 'B', 'c']);
  expect(column(2)).toEqual(['Z', 'y', 'x']);
  wb.undo();
  expect(column(0)).toEqual(['a', 'b', 'c']);
  expect(column(2)).toEqual(['z', 'y', 'x']);
  expect(wb.canUndo()).toBe(false);
});

it('leaves the rows a filter hides alone when changing case or splitting text', async () => {
  const rows = [['Key', 'Value', 'Text'], ['a', 'x1', 'p,q'], ['b', 'x2', 'r,s'], ['a', 'x3', 't,u'], ['b', 'x4', 'v,w'], ['a', 'x5', 'y,z']];
  const { wb, id, column } = await mount(rows, (wb, id) => {
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 5, c2: 2 });
    wb.setFilterCriteria(id, 0, { values: ['a'] });
  });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 4]);
  await select('B2:B6');
  await cleanup('UPPERCASE');
  expect(column(1)).toEqual(['Value', 'X1', 'x2', 'X3', 'x4', 'X5']);
  wb.undo();
  expect(column(1)).toEqual(['Value', 'x1', 'x2', 'x3', 'x4', 'x5']);
  await select('C2:C6');
  await cleanup('Split text to columns');
  expect(column(2)).toEqual(['Text', 'p', 'r,s', 't', 'v,w', 'y']);
  expect(column(3)).toEqual([null, 'q', null, 'u', null, 'z']);
  wb.undo();
  expect(column(2)).toEqual(['Text', 'p,q', 'r,s', 't,u', 'v,w', 'y,z']);
  expect(column(3)).toEqual([null, null, null, null, null, null]);
  expect(wb.canUndo()).toBe(false);
});
