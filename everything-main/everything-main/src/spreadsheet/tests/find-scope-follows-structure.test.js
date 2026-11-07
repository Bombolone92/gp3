// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';

// "Selection only" remembered one range and never looked at it again, so a row inserted or deleted behind
// the non-modal panel left the same A1:A3 covering different cells: Replace all edited the blank inserted
// row and skipped the third cell the user had highlighted, while the box still read "Selection only (A1:A3)".
let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bar?.destroy(); bar = null; vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

const option = (text) => [...bar.el.querySelectorAll('.find-option')].find((l) => l.textContent.startsWith(text));
const button = (text) => [...bar.el.querySelectorAll('button')].find((b) => b.textContent === text);
const column = (wb, id, n) => Array.from({ length: n }, (_, r) => wb.getValue(id, r, 0));

function setup(range) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const r of [0, 1, 2]) wb.setInput(id, r, 0, 'x');
  wb.setInput(id, 3, 0, 'keep');
  wb.clearHistory();
  const grid = {
    active: { r: 0, c: 0 }, range: { ...range },
    setHighlights: vi.fn(), setSelection: vi.fn((selection) => { grid.active = selection.active; }), focus: vi.fn(),
  };
  bar = createFindBar({ wb, grid, sheetId: () => id, activeCell: () => null, announce: vi.fn(), subscribe: () => vi.fn() });
  document.body.append(bar.el);
  bar.open();
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = 'x';
  query.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  return { wb, id, grid };
}

it('lets the scope go, in plain sight, when the rows move out from under it', () => {
  const { wb, id, grid } = setup({ r1: 0, c1: 0, r2: 2, c2: 0 });
  expect(option('Selection only').textContent).toBe('Selection only (A1:A3)');
  expect(bar.el.querySelector('.find-count').textContent).toBe('1 of 3');
  // The user clicks A1 and inserts a row above it: the three x's are now A2:A4.
  grid.range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  wb.insertRows(id, 0, 1);
  expect(option('Selection only').textContent).toBe('Selection only');
  expect(option('Selection only').querySelector('input').checked).toBe(false);
  expect(bar.el.querySelector('.find-count').textContent).toBe('1 of 3');
  bar.el.querySelector('[aria-label="Show replace"]').click();
  bar.el.querySelector('[aria-label="Replace with"]').value = 'y';
  button('Replace all').click();
  expect(column(wb, id, 5)).toEqual([null, 'y', 'y', 'y', 'keep']);
});

it('follows the selection the structural edit leaves behind when it is still a range', () => {
  const { wb, id, grid } = setup({ r1: 0, c1: 0, r2: 2, c2: 0 });
  // Rows 1 and 2 are selected and a row is inserted above them: the selection is still a range.
  grid.range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  wb.insertRows(id, 0, 1);
  expect(option('Selection only').textContent).toBe('Selection only (A1:A2)');
  expect(bar.el.querySelector('.find-count').textContent).toBe('1 of 1');
  bar.el.querySelector('[aria-label="Show replace"]').click();
  bar.el.querySelector('[aria-label="Replace with"]').value = 'y';
  button('Replace all').click();
  expect(column(wb, id, 5)).toEqual([null, 'y', 'x', 'x', 'keep']);
});

it('leaves the scope alone while only cell contents change', () => {
  const { wb, id } = setup({ r1: 0, c1: 0, r2: 2, c2: 0 });
  wb.setInput(id, 6, 0, 'x');
  expect(option('Selection only').textContent).toBe('Selection only (A1:A3)');
});
