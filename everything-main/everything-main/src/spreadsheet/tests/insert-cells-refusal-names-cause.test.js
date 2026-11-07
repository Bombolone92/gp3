// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Insert cells answered every refusal with "That shift would split a table or exceed the available space",
// which named two causes and covered four: a table left ragged, a table beheaded, a merged block or a
// protected range only half inside the band being shifted, or content really pushed off the sheet. The
// notice names the one that happened, and says which way to widen the selection to get past it.
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

async function mount(prep) {
  const doc = new Doc({ name: 'Shift', path: 'Spreadsheets/Shift.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) wb.setInput(id, r, c, `r${r}c${c}`);
  prep(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const shift = async (where, label) => {
    view.goTo(`Sheet1!${where}`);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('[data-menu="insert"]').click();
    item('Cells').click();
    await vi.advanceTimersByTimeAsync(1);
    item(label).click();
    await vi.advanceTimersByTimeAsync(1);
  };
  return { wb, id, toast, shift };
}

const messages = (toast) => toast.mock.calls.map(([msg]) => msg);

it('names the table a downward shift would leave ragged, and which lines to take in', { timeout: 20000 }, async () => {
  const { wb, id, toast, shift } = await mount((wb, id) => {
    wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Sales' });
  });
  await shift('A1', 'Cells, shifting down');
  expect(messages(toast)).toContain('The cells cannot be shifted: table Sales would be left ragged. Select whole columns of it, or move the table first');
  expect(wb.getValue(id, 0, 0)).toBe('r0c0');
});

it('asks for whole rows instead when the shift is sideways', { timeout: 20000 }, async () => {
  const { wb, id, toast, shift } = await mount((wb, id) => {
    wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Sales' });
  });
  await shift('A1', 'Cells, shifting right');
  expect(messages(toast)).toContain('The cells cannot be shifted: table Sales would be left ragged. Select whole rows of it, or move the table first');
  expect(wb.getValue(id, 0, 0)).toBe('r0c0');
});

it('still shifts the cells, saying nothing, when nothing stands in the way', { timeout: 20000 }, async () => {
  const { wb, id, toast, shift } = await mount(() => {});
  await shift('A1', 'Cells, shifting down');
  expect(messages(toast).filter((m) => /cannot be shifted/.test(m))).toEqual([]);
  expect(wb.getValue(id, 0, 0)).toBeNull();
  expect(wb.getValue(id, 1, 0)).toBe('r0c0');
});
