// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Insert > Checkbox over a merged block wrote FALSE into the cells hidden under the merge and
// counted them ("4 checkboxes inserted" for one merged A1:B2), so unmerging later showed four
// FALSEs. A merged block is one cell: it takes one checkbox, at its top-left, and counts once.
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

async function mount(merges) {
  const doc = new Doc({ name: 'Boxes', path: 'Spreadsheets/Boxes.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const range of merges) wb.mergeCells(id, range);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const insert = async (range) => {
    view.goTo(`Sheet1!${range}`);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('[data-menu="insert"]').click();
    item('Checkbox').click();
    await vi.advanceTimersByTimeAsync(1);
  };
  return { wb, id, toast, insert };
}

it('puts one checkbox in a merged block, at its top-left, and counts it once', async () => {
  const { wb, id, toast, insert } = await mount([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
  await insert('A1:B2');
  expect(wb.getValue(id, 0, 0)).toBe(false);
  for (const [r, c] of [[0, 1], [1, 0], [1, 1]]) expect(wb.getCell(id, r, c)?.v ?? null, `${r},${c}`).toBeNull();
  expect(toast).toHaveBeenCalledWith('Checkbox inserted. Space toggles it', expect.anything());
  wb.unmergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  for (const [r, c] of [[0, 1], [1, 0], [1, 1]]) expect(wb.getValue(id, r, c), `${r},${c}`).toBeNull();
});

it('counts a merged block among plain cells as one', async () => {
  const { wb, id, toast, insert } = await mount([{ r1: 1, c1: 0, r2: 2, c2: 0 }]);
  await insert('A1:A4');
  expect([0, 1, 3].map((r) => wb.getValue(id, r, 0))).toEqual([false, false, false]);
  expect(wb.getCell(id, 2, 0)?.v ?? null).toBeNull();
  expect(toast).toHaveBeenCalledWith('3 checkboxes inserted', expect.anything());
  expect(wb.undoLabels()).toEqual(['Insert checkboxes']);
});
