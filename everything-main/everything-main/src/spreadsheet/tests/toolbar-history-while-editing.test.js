// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

// Undo and Redo wait while a cell is being edited (the buttons are greyed for it), but their history list,
// opened by a right-click or a long press that a greyed button may still receive, did not: it opened
// mid-edit, and picking a step cancelled the edit, throwing the typed text away, before undoing.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const menus = () => document.querySelectorAll('.menu').length;
const contextmenu = (t) => t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

describe('the toolbar history list', () => {
  afterEach(() => { closeMenu(); document.body.replaceChildren(); });

  it('does not open while a cell is being edited, and opens again once the edit is over', () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, 'x');
    wb.setInput(wb.activeSheetId, 0, 1, 'y');
    wb.undo();
    const grid = { editing: true, focus() {} };
    const toolbar = createToolbar({
      wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid, subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    toolbar.refresh();
    const undo = toolbar.el.querySelector('.tb-btn[data-cmd="undo"]');
    const redo = toolbar.el.querySelector('.tb-btn[data-cmd="redo"]');
    expect(wb.canUndo() && wb.canRedo()).toBe(true);
    contextmenu(undo);
    expect(menus()).toBe(0);
    contextmenu(redo);
    expect(menus()).toBe(0);
    grid.editing = false;
    toolbar.refresh();
    contextmenu(undo);
    expect(menus()).toBe(1);
    expect(document.querySelector('.menu').getAttribute('aria-label')).toBe('Undo history');
    closeMenu();
    contextmenu(redo);
    expect(menus()).toBe(1);
    expect(document.querySelector('.menu').getAttribute('aria-label')).toBe('Redo history');
  });
});

describe('a history step picked while a cell is being edited', () => {
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
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('leaves the edit and the sheet behind it as they are, as Undo itself does', async () => {
    const doc = new Doc({ name: 'History', path: 'Spreadsheets/History.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 1, 'kept');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    // The list is opened before the edit begins (mid-edit it no longer opens), and the edit is started from the keyboard, which leaves it open.
    contextmenu(view.el.querySelector('.tb-btn[data-cmd="undo"]'));
    expect(menus()).toBe(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    const editor = view.el.querySelector('.grid-editor');
    editor.value = 'hello';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.hidden).toBe(false);
    expect(menus()).toBe(1);
    document.querySelector('.menu-item').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.hidden).toBe(false);
    expect(editor.value).toBe('hello');
    expect(wb.getValue(id, 0, 1)).toBe('kept');
    expect(wb.getValue(id, 0, 0)).toBeNull();
    expect(document.body.textContent).not.toContain('Undid');
    expect(document.activeElement).toBe(editor);
  });
});
