// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// A merged cell holds one value, at its top-left, so a block pasted over one keeps that and the workbook
// writes nothing to the cells beneath it. That is deliberate (e1a0f0c), but the paste said nothing: a 2×2
// block dropped on a merged A1:B2 kept one number and lost three without a word, and pressing on B1 — drawn
// as part of the block — snapped the paste to the anchor and lost two that would have fitted in column C.
// What is kept is unchanged; the loss is now said, in the shape Merge cells uses for the values it clears.
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

async function mount(prep) {
  const doc = new Doc({ name: 'Merge', path: 'Spreadsheets/Merge.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  prep?.(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const toast = vi.spyOn(notifications, 'toast');
  let copied = {};
  const ev = (type, data = {}) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: (t) => data[t] ?? '', setData: (t, v) => { copied[t] = v; }, files: [] } });
    return e;
  };
  const at = async (a) => { view.goTo(`Sheet1!${a}`); await vi.advanceTimersByTimeAsync(1); };
  const copy = async (a) => { copied = {}; await at(a); viewport.dispatchEvent(ev('copy')); return copied; };
  const pasteText = async (a, text) => { await at(a); viewport.dispatchEvent(ev('paste', { 'text/plain': text })); await vi.advanceTimersByTimeAsync(2); };
  const pasteCopy = async (a, own) => { await at(a); viewport.dispatchEvent(ev('paste', { 'text/plain': own['text/plain'], 'text/html': own['text/html'] })); await vi.advanceTimersByTimeAsync(2); };
  const said = () => toast.mock.calls.map(([m]) => m).filter((m) => /merged cell/.test(m));
  return { wb, id, at, copy, pasteText, pasteCopy, said, toast };
}

const merged = (wb, id) => { wb.setInput(id, 0, 0, 'title'); wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 }); };

it('says how many values a merged cell left no room for, and still keeps the one it takes', async () => {
  const { wb, id, pasteText, said } = await mount(merged);
  await pasteText('A1', '1\t2\n3\t4');
  expect(wb.getValue(id, 0, 0)).toBe(1); // what the merge takes is unchanged
  expect([wb.getValue(id, 0, 1), wb.getValue(id, 1, 0), wb.getValue(id, 1, 1)]).toEqual([null, null, null]);
  expect(said()).toEqual(['Pasted. 3 values fell under merged cells and were left out']);
});

it('counts only the values the block really carried, and says nothing when none was lost', async () => {
  const { wb, id, pasteText, said } = await mount(merged);
  // The second row of the pasted block is blank, so only B1 is lost under the merge.
  await pasteText('A1', '1\t2\n\t');
  expect(wb.getValue(id, 0, 0)).toBe(1);
  expect(said()).toEqual(['Pasted. One value fell under a merged cell and was left out']);
});

it('says nothing for a paste clear of every merge', async () => {
  const { wb, id, pasteText, said } = await mount(merged);
  await pasteText('C1', '1\t2\n3\t4');
  expect([wb.getValue(id, 0, 2), wb.getValue(id, 1, 3)]).toEqual([1, 4]);
  expect(said()).toEqual([]);
});

it('says it for a paste pressed on a cell drawn inside the merged block', async () => {
  const { wb, id, pasteText, said } = await mount(merged);
  // B1 is part of the merge, so the selection snaps to its anchor and the block lands from A1.
  await pasteText('B1', '9\t8\n7\t6');
  expect(wb.getValue(id, 0, 0)).toBe(9);
  expect(said()).toEqual(['Pasted. 3 values fell under merged cells and were left out']);
});

it('says it for cells copied in this spreadsheet, and for Paste special values only', async () => {
  const { wb, id, copy, pasteCopy, said } = await mount((wb, id) => {
    merged(wb, id);
    wb.setInput(id, 0, 4, '1'); wb.setInput(id, 0, 5, '2');
    wb.setInput(id, 1, 4, '3'); wb.setInput(id, 1, 5, '4');
  });
  const own = await copy('E1:F2');
  await pasteCopy('A1', own);
  expect(wb.getValue(id, 0, 0)).toBe(1);
  expect(said()).toEqual(['Pasted. 3 values fell under merged cells and were left out']);
});
