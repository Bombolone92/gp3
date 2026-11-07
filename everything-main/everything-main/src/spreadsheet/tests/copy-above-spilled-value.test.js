// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Ctrl+' and Ctrl+Shift+" read the stored cell above and returned without a word when there was none, so
// both chords did nothing under a spilled array result (=SEQUENCE(3)) although the cell above plainly
// showed a value. They copy that value now, with the array's number format.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function open(cells) {
  const doc = new Doc({ name: 'Spill', path: 'Spreadsheets/Spill.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  for (const [r, c, text] of cells) wb.setInput(id, r, c, text);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  const chord = async (shift) => {
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: shift ? '"' : "'", code: 'Quote', ctrlKey: true, metaKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
  };
  const goTo = async (a) => { view.goTo(`Sheet1!${a}`); await vi.advanceTimersByTimeAsync(1); };
  return { wb, id, chord, goTo };
}

it('copies the value shown by the spilled cell above with Ctrl+Shift+"', async () => {
  const { wb, id, chord, goTo } = await open([[0, 0, '=SEQUENCE(3)']]);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 2, 3]);
  await goTo('A4');
  await chord(true);
  expect(wb.getValue(id, 3, 0)).toBe(3);
  expect(wb.getCell(id, 3, 0).f).toBeNull();
});

it('copies the same value with the formula chord, which has no formula of its own to bring down', async () => {
  const { wb, id, chord, goTo } = await open([[0, 0, '=SEQUENCE(3)']]);
  await goTo('A4');
  await chord(false);
  expect(wb.getValue(id, 3, 0)).toBe(3);
  expect(wb.getCell(id, 3, 0).f).toBeNull();
});

it('brings the array’s number format with the value, so a spilled date stays a date', async () => {
  const { wb, id, chord, goTo } = await open([[0, 0, '=SEQUENCE(2)+45000']]);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'date', dateStyle: 'iso' });
  wb.clearHistory();
  const shown = wb.getDisplay(id, 1, 0);
  expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await goTo('A3');
  await chord(true);
  expect(wb.getDisplay(id, 2, 0)).toBe(shown);
});

it('still does nothing below an empty cell', async () => {
  const { wb, id, chord, goTo } = await open([[0, 0, 'x']]);
  await goTo('A5');
  await chord(true);
  expect(wb.getCell(id, 4, 0)).toBeUndefined();
  expect(wb.undoLabels()).toEqual([]);
});
