// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// When a protected range keeps every empty row, the workbook removes nothing and names the range in
// its own notice. The command's "No empty rows in the selection" then contradicted it, as if the rows
// had been full.
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
  const doc = new Doc({ name: 'Rows', path: 'Spreadsheets/Rows.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  prepare(wb, id);
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}

async function removeEmptyRows() {
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[data-menu="data"]').click();
  item('Data cleanup').click();
  [...document.querySelectorAll('.menu.submenu [role="menuitem"]')].find((b) => /^Remove empty rows/.test(b.textContent)).click();
  await vi.advanceTimersByTimeAsync(1);
  return toast.mock.calls.map((c) => c[0]);
}

it('shows only the protected notice when a protected range keeps every empty row', async () => {
  const { wb, id } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 2, 0, 'b');
    wb.protectRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, 'kept');
  });
  view.goTo('Sheet1!A1:A3');
  await vi.advanceTimersByTimeAsync(1);
  const notices = await removeEmptyRows();
  expect(notices.some((text) => /A2 is protected/.test(text))).toBe(true);
  expect(notices).not.toContain('No empty rows in the selection');
  expect(wb.getValue(id, 2, 0)).toBe('b');
});

it('still says when the selection holds no empty rows', async () => {
  await mount((wb, id) => { wb.setInput(id, 0, 0, 'a'); wb.setInput(id, 1, 0, 'b'); });
  view.goTo('Sheet1!A1:A2');
  await vi.advanceTimersByTimeAsync(1);
  expect(await removeEmptyRows()).toContain('No empty rows in the selection');
});
