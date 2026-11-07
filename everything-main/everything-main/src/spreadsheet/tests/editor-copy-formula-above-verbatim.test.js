// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Ctrl/Cmd+' in ready mode pasted a copy of the cell above, so its references shifted down a row
// (=B1*2 arrived as =B2*2), while the same chord mid-edit inserted the formula's text unchanged.
// Ctrl+' is meant to copy the formula exactly as written, which is its whole point beside Ctrl+D,
// which shifts; both modes now copy it verbatim. A value above is still copied as before.
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

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function mount(cells) {
  const doc = new Doc({ name: 'Above', path: 'Spreadsheets/Above.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const [r, c, text] of cells) wb.setInput(id, r, c, text);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const goTo = async (cell) => { view.goTo(`Sheet1!${cell}`); await vi.advanceTimersByTimeAsync(1); viewport.focus(); };
  const menu = async (...path) => {
    view.el.querySelector(`[data-menu="${path[0]}"]`).click();
    for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  return { wb, id, viewport, key, goTo, menu };
}

it("copies the formula above as written, its references unshifted", async () => {
  const { wb, id, viewport, key, goTo } = await mount([[0, 0, '=B1*2'], [0, 1, '5'], [1, 1, '7']]);
  await goTo('A2');
  key(viewport, "'", { ctrlKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 1, 0).f).toBe('B1*2');
  expect(wb.getValue(id, 1, 0)).toBe(10);
  // Mid-edit the chord inserts the same text at the caret.
  await goTo('A3');
  key(viewport, 'F2');
  const editor = view.el.querySelector('.grid-editor');
  expect(editor.hidden).toBe(false);
  key(editor, "'", { ctrlKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(editor.value).toBe('=B1*2');
  key(editor, 'Enter');
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 2, 0).f).toBe('B1*2');
  // A value above is copied as before.
  await goTo('B3');
  key(viewport, "'", { ctrlKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getValue(id, 2, 1)).toBe(7);
});

it('does the same from Edit > Fill > The formula from the cell above', async () => {
  const { wb, id, goTo, menu } = await mount([[0, 0, '=B1*2'], [0, 1, '5']]);
  await goTo('A2');
  await menu('edit', 'Fill', 'The formula from the cell above');
  expect(wb.getCell(id, 1, 0).f).toBe('B1*2');
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.getCell(id, 1, 0)?.f).toBeUndefined();
});

it('leaves the target cell its own formatting, as a typed formula would', async () => {
  const { wb, id, viewport, key, goTo } = await mount([[0, 0, '=B1*2'], [0, 1, '5']]);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'percent' });
  wb.clearHistory();
  await goTo('A2');
  key(viewport, "'", { ctrlKey: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.getCell(id, 1, 0).f).toBe('B1*2');
  expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'percent' });
  expect(wb.undoLabels()).toEqual(['Copy formula above']);
});
