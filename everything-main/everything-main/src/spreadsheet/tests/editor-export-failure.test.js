// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as P from '../src/lib/puter.js';
import * as notifications from '../src/ui/toast.js';

// Inside the Puter app an export went through Puter's save dialog, into the user's Puter files, while
// Import's "From this device" read from the computer: an export is the reverse of an import, a download
// to this device, inside the app as on the web. Saving to Puter is Save and Save a copy.
vi.mock('../src/lib/puter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isApp: () => true,
  canSaveFiles: () => true,
  saveFileAs: vi.fn(),
  downloadBlob: vi.fn(),
}));

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
  P.saveFileAs.mockReset();
  P.downloadBlob.mockReset();
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const menuItem = (test) => [...document.querySelectorAll('.menu-item')].find((n) => test(n.querySelector('.menu-label')?.textContent || ''));

it('downloads an export to this device in the Puter app, without Puter\'s save dialog', async () => {
  const doc = new Doc({ name: 'Report', path: 'Spreadsheets/Report.xlsx' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'hello');
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="file"]').click();
  menuItem((label) => label === 'Export').click();
  menuItem((label) => label === 'Sheet as .csv').click();
  await vi.advanceTimersByTimeAsync(5);
  expect(P.saveFileAs).not.toHaveBeenCalled();
  expect(P.downloadBlob).toHaveBeenCalledTimes(1);
  expect(P.downloadBlob.mock.calls[0][1]).toBe('Report.csv');
});

it('says why an export could not be made', async () => {
  const doc = new Doc({ name: 'Report', path: 'Spreadsheets/Report.xlsx' });
  vi.spyOn(doc, 'toOdsBlob').mockRejectedValue(new Error('out of memory'));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  view.el.querySelector('[data-menu="file"]').click();
  menuItem((label) => label === 'Export').click();
  menuItem((label) => label === 'OpenDocument (.ods)').click();
  await vi.advanceTimersByTimeAsync(5);
  expect(P.downloadBlob).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith('Could not export: out of memory', expect.objectContaining({ icon: 'alert' }));
});
