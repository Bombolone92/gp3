// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// On a cell inside a protected range, Shift+F2 said the cell was protected instead of opening the
// note dialog, but Ctrl+K opened the link dialog with no notice and refused only when Insert was
// pressed. The link dialog now refuses up front too, as it already did on a protected sheet.
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
  wb.setInput(id, 0, 0, 'locked text');
  wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'locked');
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${cell}`);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const key = (k, init) => viewport.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const dialog = () => document.querySelector('.modal-panel');
  return { wb, id, toast, key, dialog, toolbarLink: () => view.el.querySelector('[aria-label="Insert link"]').click() };
}

it('refuses Ctrl+K on a cell in a protected range before the dialog opens, as Shift+F2 does', async () => {
  const { toast, key, dialog } = await open('A1');
  key('k', { ctrlKey: true, metaKey: true });
  expect(dialog()).toBeNull();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A1 is protected \(locked\)/), expect.objectContaining({ icon: 'lock' }));
  toast.mockClear();
  key('F2', { shiftKey: true });
  expect(dialog()).toBeNull();
  expect(toast).toHaveBeenCalledTimes(0); // the same notice was shown a moment ago; it is not repeated
});

it('refuses the toolbar\'s Insert link on a protected cell the same way', async () => {
  const { toast, dialog, toolbarLink } = await open('A1');
  toolbarLink();
  expect(dialog()).toBeNull();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A1 is protected/), expect.objectContaining({ icon: 'lock' }));
});

it('still opens the link dialog on a cell outside the protected range', async () => {
  const { wb, id, key, dialog } = await open('B1');
  key('k', { ctrlKey: true, metaKey: true });
  expect(dialog()).toBeTruthy();
  const url = document.querySelector('input[aria-label="Link"]');
  url.value = 'https://example.com';
  url.closest('form').requestSubmit();
  expect(wb.linkAt(id, 0, 1)?.url).toBe('https://example.com');
});
