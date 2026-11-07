// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { formatValue } from '../src/core/format.js';
import * as listpicker from '../src/ui/listpicker.js';

// The value picker opens on the cell's current option. The editor already knows
// that option's index; handing it over spares the picker a scan of every item
// (each of which looks its chip up across the options) to find the checked one.
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

async function mount(value, prep = null) {
  const doc = new Doc({ name: 'Lists', path: 'Spreadsheets/Lists.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  if (prep) prep(wb, id);
  else wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: ['Red', 'Green', 'Blue'] });
  if (value != null) wb.setInput(id, 0, 0, value);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const picker = vi.spyOn(listpicker, 'openValuePicker');
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(picker).toHaveBeenCalledOnce();
  return picker.mock.calls[0][0];
}

it('hands the picker the index of the cell’s current option', async () => {
  const options = await mount('Green');
  expect(options.labels).toEqual(['Red', 'Green', 'Blue']);
  expect(options.current).toBe(1);
  expect(options.itemAt(1).checked).toBe(true);
});

it('hands it -1 when the cell holds none of the options', async () => {
  const options = await mount(null);
  expect(options.current).toBe(-1);
});

// A list drawn from a column of dates listed their serial numbers.
it('labels date options as dates in the cell’s format, and still inserts the date itself', async () => {
  let wb, id;
  const options = await mount(null, (book, sheet) => {
    wb = book; id = sheet;
    for (const [r, text] of [[0, '2024-05-01'], [1, '2024-06-15'], [2, '2024-07-31']]) wb.setInput(id, r, 1, text);
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'date' });
    wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: 'B1:B3' });
  });
  const serials = [0, 1, 2].map((r) => wb.getValue(id, r, 1));
  expect(serials.every((v) => typeof v === 'number')).toBe(true);
  const style = wb.getCell(id, 0, 0).s;
  expect(options.labels).toEqual(serials.map((v) => formatValue(v, style)));
  expect(options.labels[0]).not.toBe(String(serials[0]));
  expect(options.labels[0]).toMatch(/2024/);
  options.itemAt(1).onSelect();
  expect(wb.getValue(id, 0, 0)).toBe(serials[1]);
});

// A list drawn from a column of amounts and percentages listed bare decimals in a cell with no format of its own.
it('labels options as their source cells show them, whatever the cell’s own format', async () => {
  let wb, id;
  const options = await mount(null, (book, sheet) => {
    wb = book; id = sheet;
    for (const [r, text] of [[0, '$1,500.00'], [1, '12.5%'], [2, '2024-05-01']]) wb.setInput(id, r, 1, text);
    wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: 'B1:B3' });
  });
  expect(options.labels).toEqual(['$1,500.00', '12.50%', '2024-05-01']);
  options.itemAt(0).onSelect();
  expect(wb.getValue(id, 0, 0)).toBe(1500);
});
