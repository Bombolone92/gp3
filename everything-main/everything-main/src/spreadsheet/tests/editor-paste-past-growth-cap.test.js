// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// MAX_ROWS and MAX_COLS cap how far a sheet grows under the hands; a sheet a file brought in larger keeps
// its own size, which typing and ordinary pasting already reach the whole of. The clipboard paths read the
// caps instead, so a paste in the lower half of an imported 30,000-row sheet claimed thousands of rows
// "did not fit on the sheet", a cut-paste there was refused as running past it, and Insert copied cells
// was refused as exceeding a 20,000-row paste limit. They read the sheet's own size now.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

// The grid is the whole A1:XFD1048576 grid now, so no file brings a sheet larger than it; the paths stay checked on a
// large imported sheet, deep in its lower half.
const BIG = 30000; // the size a large import arrives with
const DEEP = 25000; // a row deep inside the sheet

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
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const said = (toast, pattern) => toast.mock.calls.some(([msg]) => pattern.test(msg));

async function mount() {
  const doc = new Doc({ name: 'Imported', path: 'Spreadsheets/Imported.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.sheet(id).rows = BIG;
  wb.setInput(id, 0, 0, 'one');
  wb.setInput(id, 1, 0, 'two');
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  let copied = {};
  const clipboardEvent = (type, data = {}) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData: (t, v) => { copied[t] = v; }, files: [] } });
    return e;
  };
  const at = async (where) => { view.goTo(`Sheet1!${where}`); await vi.advanceTimersByTimeAsync(1); };
  const cut = async (where) => { copied = {}; await at(where); viewport.dispatchEvent(clipboardEvent('cut')); return copied; };
  const copy = async (where) => { copied = {}; await at(where); viewport.dispatchEvent(clipboardEvent('copy')); return copied; };
  const paste = async (where, data) => { await at(where); viewport.dispatchEvent(clipboardEvent('paste', data)); await vi.advanceTimersByTimeAsync(1); };
  const toast = vi.spyOn(notifications, 'toast');
  return { wb, id, at, cut, copy, paste, toast };
}

it('pastes into the lower half of an imported sheet without claiming the rows did not fit', { timeout: 20000 }, async () => {
  const { wb, id, copy, paste, toast } = await mount();
  const own = await copy('A1:A2');
  await paste(`A${DEEP + 1}`, { 'text/plain': own['text/plain'], 'text/html': own['text/html'] });
  expect([wb.getValue(id, DEEP, 0), wb.getValue(id, DEEP + 1, 0)]).toEqual(['one', 'two']);
  expect(said(toast, /did not fit on the sheet/)).toBe(false);
});

it('does not refuse a cut placed there as running past the sheet', { timeout: 20000 }, async () => {
  const { cut, paste, toast } = await mount();
  const own = await cut('A1:A2');
  await paste(`A${DEEP + 1}`, { 'text/plain': own['text/plain'], 'text/html': own['text/html'] });
  expect(said(toast, /would run past the sheet/)).toBe(false);
});

it('does not refuse Insert copied cells there as exceeding a paste limit', { timeout: 20000 }, async () => {
  const { wb, id, at, copy, toast } = await mount();
  wb.setInput(id, DEEP, 0, 'here');
  wb.clearHistory();
  await copy('A1');
  await at(`A${DEEP + 1}`);
  view.el.querySelector('[data-menu="edit"]').click();
  item('Paste special').click();
  await vi.advanceTimersByTimeAsync(1);
  item('Insert copied cells, shifting down').click();
  await vi.advanceTimersByTimeAsync(1500);
  expect(said(toast, /exceed the paste limit/)).toBe(false);
  expect(wb.getValue(id, DEEP, 0)).toBe('one');
  expect(wb.getValue(id, DEEP + 1, 0)).toBe('here');
});
