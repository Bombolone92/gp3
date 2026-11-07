// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';

// "All sheets" and "Selection only" could both be ticked. The scope won without a word, so ticking All
// sheets over a selection showed "1 of 2" of four matches with the All-sheets box visibly checked. They are
// exclusive now, as the single "Search:" chooser in Sheets is.
let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bar?.destroy(); bar = null; vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

const option = (text) => [...bar.el.querySelectorAll('.find-option')].find((l) => l.textContent.startsWith(text));
const box = (text) => option(text).querySelector('input');
const tick = (text) => { const input = box(text); input.checked = !input.checked; input.dispatchEvent(new Event('change')); };
const count = () => bar.el.querySelector('.find-count').textContent;

function setup(range) {
  const wb = new Workbook();
  const first = wb.activeSheetId;
  const second = wb.addSheet('Sheet2').id;
  for (const r of [0, 1, 5]) wb.setInput(first, r, 0, 'dog');
  wb.setInput(second, 0, 0, 'dog');
  wb.setActiveSheet(first);
  wb.clearHistory();
  const grid = {
    active: { r: 0, c: 0 }, range: { ...range },
    setHighlights: vi.fn(), setSelection: vi.fn((selection) => { grid.active = selection.active; }), focus: vi.fn(),
  };
  bar = createFindBar({ wb, grid, sheetId: () => wb.activeSheetId, activeCell: () => null, announce: vi.fn(), subscribe: () => vi.fn() });
  document.body.append(bar.el);
  bar.open();
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = 'dog';
  query.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  return { wb, first, second, grid };
}

it('clears the scope when All sheets is ticked, and searches all of them', () => {
  setup({ r1: 0, c1: 0, r2: 1, c2: 0 });
  expect(count()).toBe('1 of 2');
  tick('All sheets');
  expect(box('Selection only').checked).toBe(false);
  expect(option('Selection only').textContent).toBe('Selection only');
  expect(count()).toBe('1 of 4 on 2 sheets');
});

it('clears All sheets when the scope is ticked back on', () => {
  setup({ r1: 0, c1: 0, r2: 1, c2: 0 });
  tick('All sheets');
  tick('Selection only');
  expect(box('All sheets').checked).toBe(false);
  expect(option('Selection only').textContent).toBe('Selection only (A1:A2)');
  expect(count()).toBe('1 of 2');
});

it('does not tick the scope over an All sheets the user already chose', () => {
  const { grid } = setup({ r1: 0, c1: 0, r2: 1, c2: 0 });
  tick('All sheets');
  bar.close();
  grid.range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  bar.open();
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = 'dog';
  query.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  expect(box('All sheets').checked).toBe(true);
  expect(box('Selection only').checked).toBe(false);
  expect(count()).toBe('1 of 4 on 2 sheets');
});
