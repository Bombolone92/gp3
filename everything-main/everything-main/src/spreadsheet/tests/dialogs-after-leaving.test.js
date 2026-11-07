// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';
import * as modal from '../src/ui/modal.js';
import * as notifications from '../src/ui/toast.js';

// Document details, Version history and Copy link wait on Puter before they
// open a dialog. Leaving the editor while they waited left the dialog to open
// over the home screen, with the app inert behind it.
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

function mount(path) {
  const doc = new Doc({ name: 'Budget', path });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  return doc;
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const fileMenu = (label) => { view.el.querySelector('[data-menu="file"]').click(); menuItem(label).click(); };
const leave = () => { view.destroy(); view = null; };
const appInert = () => document.getElementById('app').hasAttribute('inert');

it('does not open Document details over the next screen', async () => {
  mount('Spreadsheets/Budget.xlsx');
  let release;
  vi.spyOn(P, 'statFile').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  fileMenu('Document details…');
  await vi.advanceTimersByTimeAsync(1);
  leave();
  release({ size: 1234, modified: 1 });
  await vi.advanceTimersByTimeAsync(5);
  expect(document.querySelector('.modal-panel[aria-label="Document details"]')).toBeNull();
  expect(appInert()).toBe(false);
});

it('does not open a file picked after the editor was left', async () => {
  vi.spyOn(P, 'canPickFiles').mockReturnValue(true);
  let release;
  vi.spyOn(P, 'pickFile').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  const openPath = vi.fn();
  view = editorView({ doc, goHome: vi.fn(), openPath, newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  fileMenu('Open from Puter…');
  await vi.advanceTimersByTimeAsync(1);
  expect(P.pickFile).toHaveBeenCalledOnce();
  leave();
  release({ path: 'Spreadsheets/Other.xlsx' });
  await vi.advanceTimersByTimeAsync(5);
  expect(openPath).not.toHaveBeenCalled();
});

it('does not retitle the page after a rename that finishes once the editor was left', async () => {
  const doc = mount('Spreadsheets/Budget.xlsx');
  let release;
  vi.spyOn(doc, 'rename').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  fileMenu('Rename…');
  await vi.advanceTimersByTimeAsync(1);
  const input = document.querySelector('.modal-panel[aria-label="Rename spreadsheet"] input');
  input.value = 'Renamed';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  leave();
  doc.name = 'Renamed';
  release(null);
  await vi.advanceTimersByTimeAsync(5);
  expect(document.title).toBe('Spreadsheet');
});

it('does not retitle the page or report the copy after a save-copy that finishes once the editor was left', async () => {
  const doc = mount('Spreadsheets/Budget.xlsx');
  const toast = vi.spyOn(notifications, 'toast');
  let release;
  vi.spyOn(doc, 'saveAs').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  fileMenu('Save a copy…');
  await vi.advanceTimersByTimeAsync(1);
  const input = document.querySelector('.modal-panel[aria-label="Save a copy"] input');
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  leave();
  doc.name = 'Budget copy';
  release(null);
  await vi.advanceTimersByTimeAsync(5);
  expect(document.title).toBe('Spreadsheet');
  expect(toast).not.toHaveBeenCalledWith('Copy saved', expect.anything());
});

it('does not open Version history after the first save finishes', async () => {
  const doc = mount(null);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'unsaved');
  let release;
  vi.spyOn(doc, 'save').mockImplementation(() => new Promise((resolve) => { release = () => { doc.wb.markClean(); resolve(true); }; }));
  fileMenu('Version history…');
  await vi.advanceTimersByTimeAsync(1);
  leave();
  doc.path = 'Spreadsheets/Budget.xlsx';
  release();
  await vi.advanceTimersByTimeAsync(5);
  expect(document.querySelector('.modal-panel[aria-label="Version history"]')).toBeNull();
  expect(appInert()).toBe(false);
});

it('does not copy or show a link after the first save finishes', async () => {
  const doc = mount(null);
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { onLine: true, clipboard: { writeText } });
  const prompt = vi.spyOn(modal, 'promptDialog');
  let release;
  vi.spyOn(doc, 'save').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  view.el.querySelector('[data-menu="edit"]').click();
  menuItem('Copy link to this cell or range').click();
  await vi.advanceTimersByTimeAsync(1);
  leave();
  doc.path = 'Spreadsheets/Budget.xlsx';
  release(true);
  await vi.advanceTimersByTimeAsync(5);
  expect(writeText).not.toHaveBeenCalled();
  expect(prompt).not.toHaveBeenCalled();
});
