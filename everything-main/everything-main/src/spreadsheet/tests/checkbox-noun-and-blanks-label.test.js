// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu, isMenuOpen } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Two small wording slips: Insert > Checkbox over whole columns said "Formatting applied through row
// 200" (the cap message named formatting), and a column value spelt "(Blanks)" was listed in the
// filter menu exactly like the true blanks.
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

async function mount(prepare) {
  const doc = new Doc({ name: 'Words', path: 'Spreadsheets/Words.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  prepare(wb, id);
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}

it('names the checkboxes, not formatting, when Insert > Checkbox over whole columns stops at a row', async () => {
  const { wb, id } = await mount((wb, id) => wb.setInput(id, 19999, 4, 'far down')); // data on the grid's last row: B:D holds more cells than one command takes on
  view.goTo('Sheet1!B:D');
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[data-menu="insert"]').click();
  item('Checkbox').click();
  await vi.advanceTimersByTimeAsync(1);
  const note = toast.mock.calls.map((c) => c[0]).find((text) => /through row/.test(text));
  expect(note).toMatch(/^Checkboxes inserted through row \d+$/);
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Formatting applied/), expect.anything());
  const last = Number(note.match(/\d+$/)[0]) - 1;
  expect(wb.validationAt(id, last, 1)?.type).toBe('checkbox');
  expect(wb.validationAt(id, last + 1, 1)).toBeNull();
});

it('tells a value spelt "(Blanks)" apart from the true blanks in the filter menu', async () => {
  await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'Key');
    wb.setInput(id, 1, 0, '(Blanks)');
    wb.setInput(id, 2, 0, 'x');
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 }); // row 4 is empty: a true blank
  });
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(isMenuOpen()).toBe(true);
  expect([...document.querySelectorAll('.menu .filter-value-text')].map((n) => n.textContent)).toEqual(['"(Blanks)"', 'x', '(Blanks)']);
});
