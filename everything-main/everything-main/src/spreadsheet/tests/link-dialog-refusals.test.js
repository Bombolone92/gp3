// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// The workbook declines a link on a table's header cell (headers hold text) and on a protected cell,
// answering false; the dialog closed as if the link had been made. A header is now refused before
// the dialog opens, and a declined link is not passed off as done.
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
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function open(cell) {
  const doc = new Doc({ name: 'Links', path: 'Spreadsheets/Links.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  [['Name', 'Qty'], ['a', '1'], ['b', '2']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  expect(wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 })).toBeTruthy();
  wb.setInput(id, 4, 0, 'Notes');
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${cell}`);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  return { wb, id, toast, insert: () => view.el.querySelector('[aria-label="Insert link"]').click() };
}

it('refuses a link on a table header before the dialog opens', async () => {
  const { toast, insert } = await open('A1');
  insert();
  expect(document.querySelector('.modal-panel')).toBeNull();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/table.*header/i), expect.objectContaining({ icon: 'info' }));
});

it('does not pass a link the workbook declined off as made', async () => {
  const { wb, toast, insert } = await open('A5');
  const setLink = vi.spyOn(wb, 'setLink').mockReturnValue(false); // as the workbook answers on a protected cell, having said so itself
  insert();
  const url = document.querySelector('input[aria-label="Link"]');
  url.value = 'https://example.com';
  url.closest('form').requestSubmit();
  expect(setLink).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500); // the dialog's closing animation
  expect(document.querySelector('.modal-panel')).toBeNull(); // the dialog is gone, not stuck
  expect(toast).not.toHaveBeenCalled();
});

it('still closes and links a plain cell', async () => {
  const { wb, id, insert } = await open('A5');
  insert();
  const url = document.querySelector('input[aria-label="Link"]');
  url.value = 'https://example.com';
  url.closest('form').requestSubmit();
  expect(wb.linkAt(id, 4, 0)?.url).toBe('https://example.com');
});
