// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Ctrl+B, Ctrl+I and Ctrl+U did nothing while a cell was being typed into: the
// grid leaves the editor's keys alone and the editor's own handler had no case
// for them. They now style the cell mid-edit and keep the editor open.
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
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'Style', path: 'Spreadsheets/Style.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
  const editor = view.el.querySelector('.grid-editor');
  editor.value = 'hello';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, editor };
}
const chord = (target, key) => {
  const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

it('applies bold, italic and underline to the cell behind the editor and keeps typing', async () => {
  const { wb, id, editor } = await mount();
  expect(chord(editor, 'b')).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 0, 0)?.s?.bold).toBe(true);
  expect(editor.value).toBe('hello');
  expect(document.activeElement).toBe(editor);
  expect(chord(editor, 'i')).toBe(true);
  expect(chord(editor, 'u')).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 0, 0).s).toMatchObject({ bold: true, italic: true, underline: true });
  // Pressed again, bold comes off; the edit is still open.
  expect(chord(editor, 'b')).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 0, 0).s.bold).toBeUndefined();
  expect(editor.value).toBe('hello');
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 0, 0)).toBe('hello');
  expect(wb.getCell(id, 0, 0).s).toMatchObject({ italic: true, underline: true });
});
