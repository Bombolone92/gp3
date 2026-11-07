// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { isMenuOpen, closeMenu } from '../src/ui/menu.js';
import { setLocale } from '../src/core/format.js';

// A value filter names the texts the menu showed, and now carries the numbers behind them as keys so the
// rows stay in view when the regional format writes 1,5 for 1.5. The menu, though, still read its
// checkboxes from the texts alone: after the change every entry of a still-active numeric filter showed
// unchecked. An entry is now checked when its text is named or the number behind it is among the keys.
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
afterEach(() => { setLocale('en-US'); closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/** Column A holds 1.5, 2 and 3 under a header, filtered; the menu opens on A1 with Alt+Down. */
async function mount(prepare = null) {
  const doc = new Doc({ name: 'List', path: 'Spreadsheets/List.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Key');
  ['1.5', '2', '3'].forEach((v, i) => wb.setInput(id, i + 1, 0, v));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  prepare?.(wb, id);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  const openMenu = async () => {
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(isMenuOpen()).toBe(true);
  };
  const entries = () => Object.fromEntries([...document.querySelectorAll('.menu .filter-value')].map((l) => [l.querySelector('.filter-value-text').textContent, l.querySelector('input').checked]));
  const button = (label) => [...document.querySelectorAll('.menu .filter-actions button')].find((b) => b.textContent === label);
  const summary = () => document.querySelector('.menu .filter-summary').textContent;
  return { wb, id, openMenu, entries, button, summary };
}

it('keeps a numeric filter\'s entries checked after the regional format rewrites their text', async () => {
  const { wb, id, openMenu, entries, button, summary } = await mount();
  await openMenu();
  expect(entries()).toEqual({ '1.5': true, 2: true, 3: true });
  for (const text of ['2', '3']) [...document.querySelectorAll('.menu .filter-value')].find((l) => l.querySelector('.filter-value-text').textContent === text).querySelector('input').click();
  button('Apply').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).filter.criteria[0]).toEqual({ values: ['1.5'], keys: ['1.5'] });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 3]);
  // German writes the same number 1,5: the filter still keeps its row, and the menu still shows it chosen.
  setLocale('de-DE');
  expect(wb.getDisplay(id, 1, 0)).toBe('1,5');
  await openMenu();
  expect(entries()).toEqual({ '1,5': true, 2: false, 3: false });
  expect(summary()).toBe('1 of 3 selected');
  // Apply again: the choice is restated in the new spelling, and the same rows stay in view.
  button('Apply').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).filter.criteria[0]).toEqual({ values: ['1,5'], keys: ['1.5'] });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 3]);
});

it('still reads a text filter by its texts alone', async () => {
  const { wb, id, openMenu, entries } = await mount();
  wb.setInput(id, 1, 0, 'apple');
  wb.setFilterCriteria(id, 0, { values: ['apple'] });
  expect(wb.sheet(id).filter.criteria[0].keys).toBeUndefined();
  setLocale('de-DE');
  await openMenu();
  expect(entries()).toEqual({ apple: true, 2: false, 3: false });
});

it('opens and edits either table’s filter from its own header without resetting the other table', async () => {
  const { wb, id, openMenu, entries, button } = await mount((wb, id) => {
    wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
    wb.setFilterCriteria(id, 0, { values: ['1.5'] });
    ['Other', 'x', 'y', 'z'].forEach((v, i) => wb.setInput(id, i + 7, 0, v));
    wb.addTable(id, { r1: 7, c1: 0, r2: 10, c2: 0 });
    wb.setFilterCriteria(id, 0, { values: ['z'] });
    wb.clearHistory();
  });
  const cell = r => view.el.querySelector(`.grid-cells .cell[data-r="${r}"][data-c="0"]`);
  expect(cell(0).classList.contains('filter-on')).toBe(true);
  expect(cell(7).classList.contains('filter-on')).toBe(true);
  await openMenu();
  expect(entries()).toEqual({ '1.5': true, 2: false, 3: false });
  expect(wb.sheet(id).filter.range.r1).toBe(0);
  expect(wb.canUndo()).toBe(false);
  closeMenu();
  const box = view.el.querySelector('.name-box'); box.value = 'A8';
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  await openMenu();
  expect(entries()).toEqual({ x: false, y: false, z: true });
  [...document.querySelectorAll('.menu .filter-value')].find(l => l.querySelector('.filter-value-text').textContent === 'x').querySelector('input').click();
  button('Apply').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.filterAt(id, 0, 0).criteria[0].values).toEqual(['1.5']);
  expect([...wb.filterAt(id, 7, 0).criteria[0].values].sort()).toEqual(['x', 'z']);
  expect([...wb.sheet(id).filterHidden].sort((a, b) => a - b)).toEqual([2, 3, 9]);
  expect(view.el.textContent).toContain('3 of 6 rows shown');
});

it('renders independently hidden buttons on unselected tables', async () => {
  const { wb, id } = await mount((wb, id) => {
    wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
    wb.sheet(id).filter.showButtons = false;
    wb.setCells(id, [['Name', 'Count'], ['x', 2]].flatMap((row, r) => row.map((v, c) => ({ r: r + 6, c, cell: { v } }))));
    wb.addTable(id, { r1: 6, c1: 0, r2: 7, c2: 1 });
    wb.sheet(id).filter.hiddenButtons = [1];
    wb.setFilterRange(id, { r1: 10, c1: 0, r2: 12, c2: 0 });
  });
  const buttonAt = (r, c) => view.el.querySelector(`.grid-cells .cell[data-r="${r}"][data-c="${c}"]`).classList.contains('filter-head');
  expect(buttonAt(0, 0)).toBe(false);
  expect(buttonAt(6, 0)).toBe(true);
  expect(buttonAt(6, 1)).toBe(false);
  expect(buttonAt(10, 0)).toBe(true);
  expect(wb.filtersForSheet(id)).toHaveLength(3);
});

it('shows a native case-insensitive selection once and preserves its comparison mode on Apply', async () => {
  const { wb, id, openMenu, entries, button } = await mount((wb, id) => {
    ['Alpha', 'ALPHA', 'Beta'].forEach((value, i) => wb.setInput(id, i + 1, 0, value));
    wb.setFilterCriteria(id, 0, { values: ['alpha'], caseSensitive: false });
  });
  await openMenu();
  expect(entries()).toEqual({ Alpha: true, Beta: false });
  button('Apply').click(); await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).filter.criteria[0]).toEqual({ values: ['Alpha'], caseSensitive: false });
  expect([...wb.sheet(id).filterHidden]).toEqual([3]);
});
