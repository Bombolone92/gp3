// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

// Focus leaving the cell editor for the tab strip kept the edit open, so the
// sheet's options menu, a rename by double-click, or a tab colour ran over a
// half-typed entry. The entry is now committed first; only a tab pressed while a formula
// wants a reference keeps the edit, since that switch is for picking cells.
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
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function setup() {
  const doc = new Doc({ name: 'Tabs', path: 'Spreadsheets/Tabs.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.addSheet('Two');
  wb.setActiveSheet(id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}

/** Start an entry in the active cell and leave the editor open with `text` in it. */
async function type(text) {
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: text[0], bubbles: true, cancelable: true }));
  const editor = view.el.querySelector('.grid-editor');
  editor.value = text;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(editor.hidden).toBe(false);
  return editor;
}
const editing = () => !view.el.querySelector('.grid-editor').hidden;
const tabNamed = (name) => [...view.el.querySelectorAll('.sheet-tabs .tab')].find((t) => t.textContent === name);

describe('an open edit and the tab strip', () => {
  it('is committed when the sheet options button takes the focus', async () => {
    const { wb, id } = await setup();
    await type('hello');
    view.el.querySelector('.tab-menu-btn').focus();
    await vi.advanceTimersByTimeAsync(1);
    expect(editing()).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('hello');
  });

  it('is committed before a double-click on the tab renames the sheet, so the rename undoes on its own', async () => {
    const { wb, id } = await setup();
    await type('hello');
    const tab = tabNamed('Sheet1');
    tab.focus(); // the first click of the pair takes the focus; the second comes a moment later
    await vi.advanceTimersByTimeAsync(1);
    expect(editing()).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('hello');
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1);
    const input = document.querySelector('.modal-panel[aria-label="Rename sheet"] input');
    input.value = 'Data';
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.sheet(id).name).toBe('Data');
    expect(wb.undoLabel()).toBe('Rename sheet');
    wb.undo();
    expect(wb.sheet(id).name).toBe('Sheet1');
    expect(wb.getValue(id, 0, 0)).toBe('hello');
  });

  it('stays open across a tab pressed while the formula wants a reference, and shows that sheet', async () => {
    const { wb, id } = await setup();
    await type('=SUM(');
    const tab = tabNamed('Two');
    tab.focus();
    tab.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(editing()).toBe(true);
    expect(wb.activeSheetId).not.toBe(id);
    expect(wb.getCell(id, 0, 0)).toBeFalsy();
    // A plain entry, though, is committed by a tab press like any other click away from the cell.
    view.el.querySelector('.grid-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    wb.setActiveSheet(id);
    await vi.advanceTimersByTimeAsync(1);
    await type('plain');
    tabNamed('Two').focus();
    tabNamed('Two').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(editing()).toBe(false);
    expect(wb.getValue(id, 0, 0)).toBe('plain');
  });
});
