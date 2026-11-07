// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

// With several ranges selected (Ctrl/Cmd+click adds them), Fill down and right, Insert checkbox,
// Fit columns to content and Merge all acted on the last range alone and said nothing about the
// rest, while Bold, Clear, Hide and Delete rows already covered every range. Each now covers every
// selected range as one undo step.
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

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function open(cells) {
  const doc = new Doc({ name: 'Ranges', path: 'Spreadsheets/Ranges.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  for (const [r, c, text] of cells) wb.setInput(id, r, c, text);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  // Columns are 100px wide and rows ROW px high in jsdom; a Ctrl+drag from one cell to another adds that block.
  const pe = (type, r, c, init = {}) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: c * 100 + 50, clientY: r * ROW + ROW / 2, pointerId: 7, button: 0, pointerType: 'mouse', ...init }));
  const select = async (first, ...more) => {
    view.goTo(`Sheet1!${first}`);
    await vi.advanceTimersByTimeAsync(1);
    for (const rg of more) {
      pe('pointerdown', rg.r1, rg.c1, { ctrlKey: true, metaKey: true });
      if (rg.r2 !== rg.r1 || rg.c2 !== rg.c1) pe('pointermove', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
      pe('pointerup', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(view.el.querySelector('.status-left .status-item').textContent.split(', ')).toHaveLength(more.length + 1); // the status bar lists every range
  };
  const menu = async (...path) => {
    view.el.querySelector(`[data-menu="${path[0]}"]`).click();
    for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  return { wb, id, select, menu };
}

it('fills down and right into every selected range as one undo step', async () => {
  const { wb, id, select, menu } = await open([[0, 0, 'x'], [0, 2, 'y'], [2, 0, 'z']]);
  await select('A2', { r1: 1, c1: 2, r2: 1, c2: 2 });
  await menu('edit', 'Fill', 'Down');
  expect([wb.getValue(id, 1, 0), wb.getValue(id, 1, 2)]).toEqual(['x', 'y']);
  expect(wb.undoLabels()).toEqual(['Fill']);
  await select('B1', { r1: 2, c1: 1, r2: 2, c2: 1 });
  await menu('edit', 'Fill', 'Right');
  expect([wb.getValue(id, 0, 1), wb.getValue(id, 2, 1)]).toEqual(['x', 'z']);
  expect(wb.undoLabels()).toEqual(['Fill', 'Fill']);
});

it('inserts checkboxes into every selected range as one undo step', async () => {
  const { wb, id, select, menu } = await open([]);
  await select('A6', { r1: 5, c1: 2, r2: 6, c2: 2 });
  await menu('insert', 'Checkbox');
  expect([[5, 0], [5, 2], [6, 2]].map(([r, c]) => [wb.validationAt(id, r, c)?.type, wb.getValue(id, r, c)])).toEqual([['checkbox', false], ['checkbox', false], ['checkbox', false]]);
  expect(wb.validationAt(id, 5, 1)).toBeNull();
  expect(wb.undoLabels()).toEqual(['Insert checkboxes']);
});

it('fits the columns of every selected range to their content', async () => {
  const { wb, id, select, menu } = await open([[0, 0, 'a long text that needs a wider column'], [0, 2, 'another long text that needs a wider column']]);
  await select('A1', { r1: 0, c1: 2, r2: 0, c2: 2 });
  await menu('format', 'Rows and columns', 'Fit columns to content');
  expect(wb.colWidth(id, 0)).toBeGreaterThan(100);
  expect(wb.colWidth(id, 2)).toBeGreaterThan(100);
  expect(wb.colWidth(id, 1)).toBe(100);
  expect(wb.undoLabels()).toEqual(['Fit columns']);
});

it('merges every selected block, and unmerges them all again, as one undo step each', async () => {
  const { wb, id, select, menu } = await open([[0, 0, 'a'], [0, 3, 'd']]);
  await select('A1:B2', { r1: 0, c1: 3, r2: 1, c2: 4 });
  await menu('format', 'Merge cells', 'Merge and center');
  expect(wb.mergesIn(id, { r1: 0, c1: 0, r2: 1, c2: 1 })).toHaveLength(1);
  expect(wb.mergesIn(id, { r1: 0, c1: 3, r2: 1, c2: 4 })).toHaveLength(1);
  expect(wb.undoLabels()).toEqual(['Merge cells']);
  await select('A1:B2', { r1: 0, c1: 3, r2: 1, c2: 4 });
  await menu('format', 'Merge cells', 'Unmerge cells'); // the item says what it will do on merged cells
  expect(wb.mergesIn(id, { r1: 0, c1: 0, r2: 1, c2: 4 })).toHaveLength(0);
  expect(wb.undoLabels()).toEqual(['Unmerge cells', 'Merge cells']);
});
