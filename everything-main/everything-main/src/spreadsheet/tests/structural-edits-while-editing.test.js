// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const canvas = { font: '', measureText: (text) => ({ width: text.length * 7 }) };
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvas);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('editor commands while a cell is being edited', () => {
  let view;
  afterEach(() => { view?.destroy(); view = null; });

  async function open() {
    const doc = new Doc({ name: 'Edits', path: 'Spreadsheets/Edits.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 1, 0, 'old');
    wb.setInput(id, 2, 0, 'below');
    wb.clearHistory();
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.goTo('Sheet1!A2');
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    const editor = view.el.querySelector('.grid-editor');
    editor.value = 'hello';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1);
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((node) => node.querySelector('.menu-label')?.textContent === label);
    return { wb, id, item, editor };
  }

  it('commits the entry before inserting a row from the menu', async () => {
    const { wb, id, item, editor } = await open();
    view.el.querySelector('[data-menu="insert"]').click();
    item('Rows and columns').click();
    item('Row above').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.hidden).toBe(true);
    expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 0))).toEqual([null, null, 'hello', 'below']);
  });

  it('commits the entry before deleting the row', async () => {
    const { wb, id, item } = await open();
    view.el.querySelector('[data-menu="edit"]').click();
    item('Delete').click();
    await vi.advanceTimersByTimeAsync(1);
    item('Rows').click();
    await vi.advanceTimersByTimeAsync(1);
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([null, 'below', null]);
  });
});

describe('grid context menus while editing', () => {
  it('commits the entry before opening a cell or header menu', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const menus = [];
    const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {}, onContextMenu: (info) => menus.push(info.kind) });
    document.body.replaceChildren(grid.el);
    await vi.advanceTimersByTimeAsync(5);
    try {
      grid.beginEdit({ text: 'typed', mode: 'type' });
      grid.el.querySelector('.grid-viewport').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
      expect(grid.editing).toBe(false);
      expect(wb.getValue(id, 0, 0)).toBe('typed');
      expect(menus).toEqual(['cell']);
      // The right-click moved the selection to the cell under the pointer; the next entry goes there.
      const { r, c } = grid.active;
      grid.beginEdit({ text: 'again', mode: 'type' });
      const header = grid.el.querySelector('.hcell[data-r="1"]');
      header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(wb.getValue(id, r, c)).toBe('again');
      expect(grid.editing).toBe(false);
      expect(menus.length).toBe(2);
    } finally { grid.destroy(); }
  });
});
