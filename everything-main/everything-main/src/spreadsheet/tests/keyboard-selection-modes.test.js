// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

let view;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
  localStorage.clear(); document.body.replaceChildren();
});
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => vi.advanceTimersByTimeAsync(1);
async function mount() {
  const doc = new Doc({ name: 'Keys' }); const wb = doc.wb; const id = wb.activeSheetId;
  [['Item', 'Qty', 'Price'], ['Notebook', '3', '4.5'], ['Pencil', '6', '4.5'], ['Folder', '2', '3']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush(); return { wb, id };
}
const grid = () => view.el.querySelector('.grid-viewport');
const press = (key, extra = {}) => grid().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const nameBox = () => view.el.querySelector('.name-box').value;
const keyMode = () => { const n = view.el.querySelector('.status-key-mode'); return n.hidden ? '' : n.textContent; };
const go = async ref => { view.goTo(ref); await flush(); grid().focus(); };

it('jumps with End Mode: End, then an arrow, goes to the edge of the data; End, then Home, to its last cell', async () => {
  await mount(); await go('A1');
  press('End'); await flush();
  expect(keyMode()).toBe('End Mode');
  press('ArrowDown'); await flush();
  expect(nameBox()).toBe('A4');
  expect(keyMode()).toBe('');
  press('End'); press('Home'); await flush();
  expect(nameBox()).toBe('C4');
});

it('extends with F8 and adds ranges with Shift+F8, and Escape ends either', async () => {
  await mount(); await go('A1');
  press('F8'); await flush();
  expect(keyMode()).toBe('Extend Selection');
  press('ArrowRight'); press('ArrowDown'); await flush();
  expect(nameBox()).toBe('A1:B2');
  press('Escape'); await flush();
  expect(keyMode()).toBe('');
  press('F8', { shiftKey: true }); await flush();
  expect(keyMode()).toBe('Add to Selection');
  press('ArrowRight'); press('ArrowRight'); await flush();
  expect(view.el.querySelectorAll('.sel-extras .sel-range').length).toBeGreaterThan(0);
  press('F8', { shiftKey: true }); await flush();
  expect(keyMode()).toBe('');
});

it('keeps only the active cell with Shift+Backspace and walks the corners with Ctrl+.', async () => {
  await mount(); await go('A1:C4');
  press('.', { ctrlKey: true, metaKey: true }); await flush();
  expect(view.el.querySelector('.name-box').value).toBe('A1:C4');
  press('Backspace', { shiftKey: true }); await flush();
  expect(nameBox()).toBe('C1');
});

it('selects row differences with Ctrl+\\ and the visible cells with Alt+;', async () => {
  const { wb, id } = await mount();
  await go('B2:C4');
  press('\\', { ctrlKey: true, metaKey: true, code: 'Backslash' }); await flush();
  // Compared with the active column B in each row: C2 (4.5 vs 3), C3 (4.5 vs 6) and C4 (3 vs 2) all differ.
  expect(nameBox()).toMatch(/C2:C4|C2/);
  wb.setHidden(id, 'row', [2], true); await flush();
  await go('A1:C4');
  press(';', { altKey: true, code: 'Semicolon' }); await flush();
  expect(view.el.querySelectorAll('.sel-extras .sel-range').length + 1).toBe(2);
});

it('repeats the last formatting command with F4, and with Ctrl+Y when there is nothing to redo', async () => {
  const { wb, id } = await mount();
  await go('A1');
  press('b', { ctrlKey: true, metaKey: true }); await flush();
  expect(wb.getCell(id, 0, 0).s.bold).toBe(true);
  await go('A2');
  press('F4'); await flush();
  expect(wb.getCell(id, 1, 0).s.bold).toBe(true);
  await go('A3');
  press('y', { ctrlKey: true, metaKey: true }); await flush();
  expect(wb.getCell(id, 2, 0).s.bold).toBe(true);
});

it('asks how the cells move when Ctrl+- or Ctrl+Shift+= acts on part of a sheet', async () => {
  const { wb, id } = await mount();
  await go('B2');
  press('=', { ctrlKey: true, metaKey: true, shiftKey: true }); await flush();
  const dialog = document.querySelector('.insert-delete-cells');
  expect([...dialog.querySelectorAll('label')].map(n => n.textContent)).toEqual(['Shift cells right', 'Shift cells down', 'Entire row', 'Entire column']);
  dialog.querySelector('input[value="down"]').checked = true;
  dialog.requestSubmit(); await flush(); await vi.advanceTimersByTimeAsync(300);
  expect([wb.getValue(id, 1, 1), wb.getValue(id, 2, 1), wb.getValue(id, 1, 0)]).toEqual([null, 3, 'Notebook']);
  await go('B2');
  press('-', { ctrlKey: true, metaKey: true }); await flush();
  const del = document.querySelector('.insert-delete-cells');
  del.querySelector('input[value="up"]').checked = true;
  del.requestSubmit(); await flush();
  expect([wb.getValue(id, 1, 1), wb.getValue(id, 2, 1)]).toEqual([3, 6]);
});

it('evaluates the selected part of a formula with F9 and writes argument names with Ctrl+Shift+A, while typing', async () => {
  const { wb, id } = await mount();
  await go('E1');
  press('=');
  const editor = view.el.querySelector('.grid-editor');
  const type = (text) => { editor.value = text; editor.dispatchEvent(new Event('input', { bubbles: true })); };
  type('=B2*C2+1');
  editor.setSelectionRange(1, 6); // B2*C2
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true }));
  expect(editor.value).toBe('=13.5+1');
  type('=ROUND');
  editor.setSelectionRange(6, 6);
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  expect(editor.value).toMatch(/^=ROUND\(.+\)$/);
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flush();
  expect(wb.getCell(id, 0, 4)).toBeUndefined();
});

it('goes to the first cell past frozen panes with Ctrl+Home', async () => {
  const { wb, id } = await mount();
  wb.setFrozen?.(id, 1, 1) ?? wb.setSheetView(id, { frozenRows: 1, frozenCols: 1 });
  await go('C4');
  press('Home', { ctrlKey: true, metaKey: true }); await flush();
  expect(nameBox()).toBe('B2');
});
