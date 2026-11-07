// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Clear, Bold, Fill and Delete rows leave out the rows a filter hides; Insert checkbox and Replace
// formulas with values wrote into them, out of view.
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

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

/** A filtered list: column A keeps only "a" rows, hiding rows 3 and 4 (1-based); column B doubles column C. */
async function open() {
  const doc = new Doc({ name: 'Filtered', path: 'Spreadsheets/Filtered.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  [['Key', 'Double', 'N'], ['a', '=C2*2', '1'], ['b', '=C3*2', '2'], ['b', '=C4*2', '3'], ['a', '=C5*2', '4']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 2 });
  wb.setFilterCriteria(id, 0, { formula: 'A2="a"' });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 3]);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const menu = async (...path) => {
    view.el.querySelector(`[data-menu="${path[0]}"]`).click();
    for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
  };
  return { wb, id, menu };
}

it('inserts checkboxes into the shown rows only', async () => {
  const { wb, id, menu } = await open();
  view.goTo('Sheet1!D2:D5');
  await vi.advanceTimersByTimeAsync(1);
  await menu('insert', 'Checkbox');
  expect([1, 2, 3, 4].map((r) => wb.validationAt(id, r, 3)?.type ?? null)).toEqual(['checkbox', null, null, 'checkbox']);
  expect([1, 2, 3, 4].map((r) => wb.getValue(id, r, 3))).toEqual([false, null, null, false]);
  expect(wb.undoLabels()).toEqual(['Insert checkboxes']);
});

it('replaces formulas with values in the shown rows only', async () => {
  const { wb, id, menu } = await open();
  view.goTo('Sheet1!B2:B5');
  await vi.advanceTimersByTimeAsync(1);
  await menu('tools', 'Replace formulas with values');
  expect([1, 2, 3, 4].map((r) => wb.getCell(id, r, 1)?.f ?? null)).toEqual([null, 'C3*2', 'C4*2', null]);
  expect([1, 2, 3, 4].map((r) => wb.getValue(id, r, 1))).toEqual([2, 4, 6, 8]);
  expect(wb.undoLabels()).toEqual(['Replace formulas with values']);
});
