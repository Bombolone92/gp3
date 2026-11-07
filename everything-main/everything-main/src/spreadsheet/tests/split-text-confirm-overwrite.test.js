// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// Split text to columns wrote the pieces over the cells right of the selection without asking, so a
// value sitting there was lost in one step. It now asks before replacing them, and only when a target
// cell holds something.
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

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
// The newest dialog: one just cancelled is still in the page while it closes.
const modal = () => [...document.querySelectorAll('.modal-root:not(.closing)')].at(-1) ?? null;
const dialog = () => modal()?.querySelector('[role="dialog"]') ?? null;
const button = (label) => [...(modal()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label);

async function mount(cells) {
  const doc = new Doc({ name: 'Split', path: 'Spreadsheets/Split.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const [r, c, text] of cells) wb.setInput(id, r, c, text);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const split = async (range) => {
    view.goTo(`Sheet1!${range}`);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('[data-menu="data"]').click();
    for (const label of ['Data cleanup', 'Split text to columns']) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  const row = (r, n) => Array.from({ length: n }, (_, c) => wb.getValue(id, r, c));
  return { wb, id, toast, split, row };
}

it('asks before writing a piece over a cell that holds something, and leaves everything as it was on Cancel', async () => {
  const { wb, toast, split, row } = await mount([[0, 0, 'a,b'], [0, 1, 'old'], [1, 0, 'c,d']]);
  await split('A1:A2');
  expect(dialog()).not.toBeNull();
  expect(dialog().textContent).toContain('The destination cells already contain data. Overwrite them?');
  button('Cancel').click();
  await vi.advanceTimersByTimeAsync(500);
  expect(row(0, 2)).toEqual(['a,b', 'old']);
  expect(row(1, 2)).toEqual(['c,d', null]);
  expect(wb.undoLabels()).toEqual([]);
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Split /));
  // Overwrite goes ahead, as one step.
  await split('A1:A2');
  expect(dialog()).not.toBeNull();
  button('Overwrite').click();
  await vi.advanceTimersByTimeAsync(500);
  expect(row(0, 2)).toEqual(['a', 'b']);
  expect(row(1, 2)).toEqual(['c', 'd']);
  expect(toast).toHaveBeenCalledWith('Split 2 cells into 2 columns');
  expect(wb.undoLabels()).toEqual(['Split text']);
});

it('asks nothing when the cells the pieces land in are empty, or hold only cells of the first piece', async () => {
  const { split, row } = await mount([[0, 0, 'x;y;z'], [0, 3, 'kept'], [1, 0, 'plain'], [1, 1, 'stays']]);
  await split('A1:A2');
  expect(dialog()).toBeNull();
  expect(row(0, 4)).toEqual(['x', 'y', 'z', 'kept']);
  expect(row(1, 2)).toEqual(['plain', 'stays']); // no delimiter in A2: nothing lands in B2
});

it('asks for a chosen separator too, judging the pieces by that separator', async () => {
  const { split, row } = await mount([[0, 0, 'a;b,c'], [0, 1, 'old']]);
  // Detected: the semicolon and the comma are found in one row each; the first candidate that wins, a comma, makes two pieces, and B1 holds something.
  await split('A1');
  expect(dialog()).not.toBeNull();
  button('Overwrite').click();
  await vi.advanceTimersByTimeAsync(500);
  expect(row(0, 2)).toEqual(['a;b', 'c']);
});
