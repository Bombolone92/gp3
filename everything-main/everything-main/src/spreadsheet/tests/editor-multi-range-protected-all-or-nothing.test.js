// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Fill down and formatting over several selected ranges (Ctrl/Cmd+click adds them) ran one
// workbook call per range, so a protected cell in one range refused that range alone while the
// others were filled or formatted: half an action, in one undo step. A single range holding the
// same cell is refused whole; every range now is. And the notice was
// throttled by time alone, so a refusal on a different range within 2.5 s was silent.
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

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const column = (wb, id, c, n) => Array.from({ length: n }, (_, r) => wb.getValue(id, r, c));

async function open(cells, protectedRanges) {
  const doc = new Doc({ name: 'Ranges', path: 'Spreadsheets/Ranges.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  for (const [r, c, text] of cells) wb.setInput(id, r, c, text);
  for (const range of protectedRanges) wb.protectRange(id, range);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  // Columns are 100px wide and rows 26px high in jsdom; a Ctrl+drag from one cell to another adds that block.
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
  const menu = async (...path) => {
    view.el.querySelector(`[data-menu="${path[0]}"]`).click();
    for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  const toast = vi.spyOn(notifications, 'toast');
  return { wb, id, select, menu, toast };
}

const protectedNotices = (toast, cell) => toast.mock.calls.filter(([msg]) => typeof msg === 'string' && msg.startsWith(`${cell} is protected`));

it('fills every selected range or none of them when one holds a protected cell, and says which', async () => {
  const { wb, id, select, menu, toast } = await open([[0, 0, '1'], [0, 2, '1']], [{ r1: 1, c1: 2, r2: 1, c2: 2 }]);
  await select('A1:A3', { r1: 0, c1: 2, r2: 2, c2: 2 });
  await menu('edit', 'Fill', 'Down');
  expect(column(wb, id, 0, 3)).toEqual([1, null, null]);
  expect(column(wb, id, 2, 3)).toEqual([1, null, null]);
  expect(wb.undoLabels()).toEqual([]);
  expect(protectedNotices(toast, 'C2')).toHaveLength(1);
  await select('A1:C1', { r1: 1, c1: 0, r2: 1, c2: 2 });
  await vi.advanceTimersByTimeAsync(3000);
  await menu('edit', 'Fill', 'Right');
  expect(wb.getValue(id, 0, 1)).toBeNull();
  expect(wb.undoLabels()).toEqual([]);
});

it('formats every selected range or none, and a refusal on another range is not swallowed by the notice throttle', async () => {
  const { wb, id, select, menu, toast } = await open([[0, 0, '1'], [0, 2, '1'], [0, 4, '1']], [{ r1: 1, c1: 2, r2: 1, c2: 2 }, { r1: 1, c1: 4, r2: 1, c2: 4 }]);
  await select('A1:A3', { r1: 0, c1: 2, r2: 2, c2: 2 });
  await menu('format', 'Text', 'Bold');
  expect(wb.getCell(id, 0, 0)?.s?.bold).toBeUndefined();
  expect(wb.undoLabels()).toEqual([]);
  expect(protectedNotices(toast, 'C2')).toHaveLength(1);
  // Straight away, another range: its own notice, not swallowed as a repeat of the last one.
  await select('A1:A3', { r1: 0, c1: 4, r2: 2, c2: 4 });
  await menu('format', 'Text', 'Bold');
  expect(wb.getCell(id, 0, 0)?.s?.bold).toBeUndefined();
  expect(protectedNotices(toast, 'E2')).toHaveLength(1);
  // The same range refused again at once is one notice, not a flood.
  await menu('format', 'Text', 'Italic');
  expect(protectedNotices(toast, 'E2')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3000);
  await menu('format', 'Text', 'Italic');
  expect(protectedNotices(toast, 'E2')).toHaveLength(2);
  expect(wb.undoLabels()).toEqual([]);
});

it('still formats a plain selection of several ranges as one step', async () => {
  const { wb, id, select, menu } = await open([[0, 0, '1'], [0, 2, '1']], []);
  await select('A1:A3', { r1: 0, c1: 2, r2: 2, c2: 2 });
  await menu('format', 'Text', 'Bold');
  expect(wb.getCell(id, 0, 0).s.bold).toBe(true);
  expect(wb.getCell(id, 2, 2)?.s?.bold).toBe(true);
  expect(wb.undoLabels()).toEqual(['Format']);
});
