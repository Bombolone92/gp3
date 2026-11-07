// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flashFill } from '../src/core/flashfill.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [['John Smith', 'Mary Jane Watson'], 'John', 'Mary'],
  [['John Smith', 'Mary Jane Watson'], 'Smith', 'Watson'],
  [['John Smith', 'Ann Lee'], 'J. Smith', 'A. Lee'],
  [['john.smith@acme.com', 'ann.lee@globex.org'], 'acme', 'globex'],
  [['ann lee', 'bo diddley'], 'ANN LEE', 'BO DIDDLEY'],
  [['2026-05-01', '2025-12-31'], '05', '12'],
])('learns %j → %s and fills %s', ([first, second], example, expected) => {
  expect(flashFill([{ sources: [first], target: example }, { sources: [second], target: null }])).toEqual([undefined, expected]);
});

it('builds from several columns and checks every example', () => {
  expect(flashFill([{ sources: ['john', 'smith'], target: 'Smith, John' }, { sources: ['mary', 'watson'], target: null }])).toEqual([undefined, 'Watson, Mary']);
  // Two examples that no single pattern explains: nothing is guessed.
  expect(flashFill([{ sources: ['a b'], target: 'a' }, { sources: ['c d'], target: 'd' }, { sources: ['e f'], target: null }])).toBe(null);
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

it('fills the column from Ctrl+E under a header, as one undo step', async () => {
  const doc = new Doc({ name: 'Flash' }); const wb = doc.wb; const id = wb.activeSheetId;
  [['Full name', 'First'], ['Ada Lovelace', 'Ada'], ['Alan Turing', ''], ['Grace Hopper', '']].forEach((row, r) => row.forEach((v, c) => { if (v) wb.setInput(id, r, c, v); }));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  view.goTo('B3'); await vi.advanceTimersByTimeAsync(1);
  const grid = view.el.querySelector('.grid-viewport'); grid.focus();
  grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect([2, 3].map(r => wb.getValue(id, r, 1))).toEqual(['Alan', 'Grace']);
  expect(wb.getValue(id, 0, 1)).toBe('First');
  wb.undo();
  expect([2, 3].map(r => wb.getValue(id, r, 1))).toEqual([null, null]);
});

it('fills up and left from the last row or column of the selection', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 3, 0, 'bottom');
  wb.fillDirection(id, { r1: 0, c1: 0, r2: 3, c2: 0 }, 'up');
  expect([0, 1, 2].map(r => wb.getValue(id, r, 0))).toEqual(['bottom', 'bottom', 'bottom']);
  wb.setInput(id, 5, 3, 'right');
  wb.fillDirection(id, { r1: 5, c1: 1, r2: 5, c2: 3 }, 'left');
  expect([1, 2].map(c => wb.getValue(id, 5, c))).toEqual(['right', 'right']);
});
