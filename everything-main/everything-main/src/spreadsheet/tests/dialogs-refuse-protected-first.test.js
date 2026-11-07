// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// The Note, Link and Resize dialogs opened on a protected sheet, and the note dialog on a protected
// cell, and only refused when submitted; like the other commands they now say so before opening.
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

async function open(prepare) {
  const doc = new Doc({ name: 'Locked', path: 'Spreadsheets/Locked.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Total');
  prepare(wb, id);
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const menu = async (...path) => {
    view.el.querySelector(`[data-menu="${path[0]}"]`).click();
    for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  /** The protected notice is shown at most once every few seconds; each attempt here gets its own. */
  const attempt = async (...path) => { toast.mockClear(); await vi.advanceTimersByTimeAsync(3000); await menu(...path); await vi.advanceTimersByTimeAsync(1); };
  return { wb, id, toast, attempt };
}

it('says the sheet is protected instead of opening the note, link and resize dialogs', async () => {
  const { toast, attempt } = await open((wb, id) => wb.setSheetProtected(id, true));
  for (const path of [['insert', 'Note'], ['insert', 'Link…'], ['format', 'Rows and columns', 'Resize columns…'], ['format', 'Rows and columns', 'Resize rows…']]) {
    await attempt(...path);
    expect(toast, path.join(' > ')).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));
    expect(document.querySelector('.modal-panel'), path.join(' > ')).toBeNull();
  }
});

it('says the cell is protected instead of opening the note dialog on a protected range', async () => {
  const { toast, attempt } = await open((wb, id) => wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'Totals'));
  await attempt('insert', 'Note');
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/A1 is protected \(Totals\)/), expect.objectContaining({ icon: 'lock' }));
  expect(document.querySelector('.modal-panel')).toBeNull();
});
