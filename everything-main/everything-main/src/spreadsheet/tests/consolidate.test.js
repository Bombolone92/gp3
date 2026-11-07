// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consolidate } from '../src/core/consolidate.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

it('combines ranges by position, and by top-row and left-column labels', () => {
  expect(consolidate([[[1, 2], [3, 4]], [[10, 20], [30, 40, 50]]], { fn: 'sum' })).toEqual([[11, 22, null], [33, 44, 50]]);
  const east = [[null, 'Q1', 'Q2'], ['Pens', 10, 20], ['Ink', 5, 6]];
  const west = [[null, 'Q2', 'Q3'], ['Ink', 1, 2], ['Paper', 7, 8]];
  expect(consolidate([east, west], { fn: 'sum', topRow: true, leftColumn: true })).toEqual([
    [null, 'Q1', 'Q2', 'Q3'], ['Pens', 10, 20, null], ['Ink', 5, 7, 2], ['Paper', null, 7, 8]]);
  expect(consolidate([east, west], { fn: 'average', topRow: true, leftColumn: true })[2]).toEqual(['Ink', 5, 3.5, 2]);
  expect(consolidate([east, west], { fn: 'count', topRow: true, leftColumn: true })[2]).toEqual(['Ink', 1, 2, 1]);
});

let view;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
  localStorage.clear(); document.body.replaceChildren();
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('consolidates two sheets\' tables from Data ▸ Consolidate into the active cell, as one undo step', async () => {
  const doc = new Doc({ name: 'Regions' }); const wb = doc.wb; const one = wb.activeSheetId;
  const two = wb.addSheet('West').id; wb.setActiveSheet(one);
  [['', 'Q1'], ['Pens', '10'], ['Ink', '5']].forEach((row, r) => row.forEach((v, c) => { if (v) wb.setInput(one, r, c, v); }));
  [['', 'Q1'], ['Ink', '2'], ['Paper', '7']].forEach((row, r) => row.forEach((v, c) => { if (v) wb.setInput(two, r, c, v); }));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  view.goTo('E1'); await vi.advanceTimersByTimeAsync(1);
  [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(t => t.textContent === 'Data').click(); await vi.advanceTimersByTimeAsync(1);
  [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === 'Consolidate').click(); await vi.advanceTimersByTimeAsync(1);
  const dialog = document.querySelector('.consolidate-dialog');
  const reference = dialog.querySelector('input[aria-label="Reference"]');
  const addBtn = [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Add');
  reference.value = 'Sheet1!A1:B3'; addBtn.click();
  reference.value = 'West!A1:B3'; addBtn.click();
  for (const box of dialog.querySelectorAll('input[type="checkbox"]')) box.checked = true;
  dialog.requestSubmit(); await vi.advanceTimersByTimeAsync(1);
  expect([0, 1, 2, 3].map(r => [wb.getValue(one, r, 4), wb.getValue(one, r, 5)])).toEqual([[null, 'Q1'], ['Pens', 10], ['Ink', 7], ['Paper', 7]]);
  wb.undo();
  expect(wb.getValue(one, 1, 4)).toBe(null);
});
