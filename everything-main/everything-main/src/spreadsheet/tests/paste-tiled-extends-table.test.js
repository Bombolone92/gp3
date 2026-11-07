// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Rows pasted right under a table join it. A paste whose target is a whole number of copies of the
// clipboard is tiled over that target, so the cells written are the whole selection, not one copy of the
// block: the table has to be offered all of them, or the repeats below the first would sit outside it.
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
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'Tiles', path: 'Spreadsheets/Tiles.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  const rows = [['Name', 'Qty'], ['a', '1'], ['b', '2']];
  rows.forEach((row, r) => row.forEach((text, c) => wb.setInput(id, r, c, text)));
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
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
  const copy = async (where) => { copied = {}; view.goTo(`Sheet1!${where}`); await vi.advanceTimersByTimeAsync(1); viewport.dispatchEvent(clipboardEvent('copy')); return copied; };
  const paste = async (where, data) => { view.goTo(`Sheet1!${where}`); await vi.advanceTimersByTimeAsync(1); viewport.dispatchEvent(clipboardEvent('paste', data)); await vi.advanceTimersByTimeAsync(1); };
  return { wb, id, copy, paste };
}

it('takes every tiled row into the table when the paste starts on the row under it', async () => {
  const { wb, id, copy, paste } = await mount();
  const own = await copy('A3:B3');
  await paste('A4:B7', { 'text/plain': own['text/plain'], 'text/html': own['text/html'] });
  expect(wb.getValue(id, 6, 0)).toBe('b'); // the fourth copy landed
  // The table grew over all four rows, not just the first copy.
  expect(wb.tableAt(id, 6, 0)?.name).toBe('Sales');
  expect(wb.tableAt(id, 3, 0)?.name).toBe('Sales');
});

it('offers the table the whole tiled block when the paste starts on the table’s last row', async () => {
  const { wb, id, copy, paste } = await mount();
  const cover = vi.spyOn(wb, 'extendTableToCover');
  const own = await copy('A3:B3');
  await paste('A3:B5', { 'text/plain': own['text/plain'], 'text/html': own['text/html'] });
  expect(wb.getValue(id, 4, 0)).toBe('b'); // three copies written, the last two past the table's end
  expect(cover).toHaveBeenCalledWith(id, { r1: 2, c1: 0, r2: 4, c2: 1 });
});

it('takes adjacent copied columns into the table and undoes cells and geometry together', async () => {
  const { wb, id, copy, paste } = await mount();
  const before=wb.toJSON(), own=await copy('B1:B3');
  await paste('C1:D3', own);
  expect(wb.activeSheet.tables[0].range).toEqual({r1:0,c1:0,r2:2,c2:3});
  expect(wb.tableColumns(id,wb.activeSheet.tables[0])).toEqual(['Name','Qty','Qty2','Qty3']);
  expect(wb.getValue(id,2,3)).toBe(2);
  wb.undo();
  const after=wb.toJSON();
  // Navigation is not part of the paste's Undo record.
  after.sheets[0].viewSelection=before.sheets[0].viewSelection;
  expect(after).toEqual(before);
});

it('takes externally pasted column data into the table', async () => {
  const { wb, id, paste } = await mount();
  await paste('C1', {'text/plain':'Cost\n8\n12'});
  expect(wb.activeSheet.tables[0].range.c2).toBe(2);
  expect(wb.getValue(id,0,2)).toBe('Cost');
  expect(wb.getValue(id,2,2)).toBe(12);
});
