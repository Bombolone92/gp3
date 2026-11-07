// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Ctrl+Shift+" copied the cell above by re-parsing its displayed text, so a
// number shown rounded arrived rounded and text that reads as a number became one.
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

async function mount(prep) {
  const doc = new Doc({ name: 'Above', path: 'Spreadsheets/Above.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  prep(wb, id);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}
async function select(text) {
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = text;
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
}
const copyValueAbove = () => {
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: '"', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
};

it('copies the number above at full precision, with its format when the cell has none', async () => {
  const { wb, id } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, '1234.5678');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'number', dec: 2 });
    expect(wb.getDisplay(id, 0, 0)).toBe('1,234.57');
  });
  await select('A2');
  copyValueAbove();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 1, 0)).toBe(1234.5678);
  expect(wb.getCell(id, 1, 0).s).toMatchObject({ fmt: 'number', dec: 2 });
  expect(wb.getDisplay(id, 1, 0)).toBe('1,234.57');
});

it('keeps text that reads as a number as text, and leaves the target cell its own format', async () => {
  const { wb, id } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, "'0042");
    wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
  });
  await select('A2');
  copyValueAbove();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 1, 0)).toBe('0042');
  expect(wb.getCell(id, 1, 0).s).toEqual({ bold: true });
});

it('inserts the displayed text at the caret while a cell is being edited', async () => {
  const { wb, id } = await mount((wb, id) => { wb.setInput(id, 0, 0, '1234.5678'); wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'number', dec: 2 }); });
  await select('A2');
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true }));
  const editor = view.el.querySelector('.grid-editor');
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: '"', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(editor.value).toBe('=1,234.57');
  expect(wb.getCell(id, 1, 0)?.v ?? null).toBeNull();
});
