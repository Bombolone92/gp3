// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// While a cell is being edited, Undo, Paste, Fill, Clear contents and Merge do
// nothing (the sheet behind the edit is off limits), yet the Edit and Format
// menus offered them as if they worked.
const leaf = (menus, id, label) => menuLeaves(menus.find((m) => m.id === id).items).find((it) => it.label === label);

describe('menu definitions', () => {
  it('disable the commands that wait for the edit to end, and only those', () => {
    const editing = menubarMenus({ editing: true, canUndo: true, canRedo: true });
    for (const label of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Values only', 'Transposed', 'Divide', 'Down', 'Right', 'Clear contents']) {
      expect(leaf(editing, 'edit', label).disabled, label).toBe(true);
    }
    for (const label of ['Merge and center', 'Merge horizontally', 'Merge vertically']) expect(leaf(editing, 'format', label).disabled, label).toBe(true);
    for (const label of ['Series…', 'Today’s date', 'The formula from the cell above', 'Find and replace…', 'Clear formatting', 'All']) {
      expect(leaf(editing, 'edit', label).disabled, label).toBeFalsy();
    }
    const idle = menubarMenus({ editing: false, canUndo: true, canRedo: true });
    for (const label of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Values only', 'Down', 'Clear contents']) expect(leaf(idle, 'edit', label).disabled, label).toBeFalsy();
    expect(leaf(idle, 'format', 'Merge and center').disabled).toBeFalsy();
  });
});

describe('the editor mid-edit', () => {
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

  it('greys those items out in the menu bar and re-enables them once the edit is committed', async () => {
    const doc = new Doc({ name: 'Menus', path: 'Spreadsheets/Menus.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'first');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    expect(view.el.querySelector('.grid-editor')).not.toBeNull();
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    view.el.querySelector('[data-menu="edit"]').click();
    expect(item('Undo').disabled).toBe(true);
    expect(item('Paste').disabled).toBe(true);
    expect(item('Clear contents').disabled).toBe(true);
    expect(item('Find and replace…').disabled).toBe(false);
    item('Clear contents').click();
    expect(wb.getValue(id, 0, 0)).toBe('first'); // still there: the click did nothing
    view.el.querySelector('[data-menu="edit"]').click(); // closes
    await vi.advanceTimersByTimeAsync(1);
    const editor = view.el.querySelector('.grid-editor');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getValue(id, 0, 0)).toBe('x');
    view.el.querySelector('[data-menu="edit"]').click();
    expect(item('Undo').disabled).toBe(false);
    expect(item('Clear contents').disabled).toBe(false);
  });
});
