// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bar?.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); document.body.replaceChildren(); });

function setup(cells) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  cells.forEach((text, r) => wb.setInput(id, r, 0, text));
  const grid = { active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 }, setHighlights: vi.fn(), setSelection: vi.fn((s) => { grid.active = s.active; }), focus: vi.fn() };
  bar = createFindBar({ wb, grid, sheetId: () => id, activeCell: () => null, announce: vi.fn(), subscribe: () => vi.fn() });
  document.body.append(bar.el);
  bar.open({ replace: true });
  const formulas = [...bar.el.querySelectorAll('label')].find((l) => l.textContent === 'Search formulas').querySelector('input');
  formulas.checked = false; formulas.dispatchEvent(new Event('change'));
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = '11'; query.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  bar.el.querySelector('[aria-label="Replace with"]').value = '9';
  const button = (text) => [...bar.el.querySelectorAll('button')].find((b) => b.textContent === text);
  return { wb, id, grid, button, count: bar.el.querySelector('.find-count') };
}

// With "Search formulas" off a formula whose result matched stayed in the list after Replace all, and
// Replace on it did nothing, with no word about why.
it('says how many matches are formula results that Replace all left alone', () => {
  const { wb, id, button, count } = setup(['=10+1', '11']);
  expect(count.textContent).toBe('1 of 2');
  button('Replace all').click();
  expect(wb.getCell(id, 0, 0).f).toBe('10+1');
  expect(wb.getValue(id, 1, 0)).toBe(9);
  expect(toast).toHaveBeenLastCalledWith('Replaced 1 cell; 1 formula result left alone', expect.objectContaining({ icon: 'check' }));
  expect(count.textContent).toBe('1 of 1');
});

it('explains a Replace all that changed nothing because every match is a formula result', () => {
  const { wb, id, button } = setup(['=10+1', '=22/2']);
  button('Replace all').click();
  expect(wb.getCell(id, 0, 0).f).toBe('10+1');
  expect(wb.getCell(id, 1, 0).f).toBe('22/2');
  expect(toast).toHaveBeenLastCalledWith('Nothing replaced: the matches are formula results', expect.objectContaining({ icon: 'info' }));
});

it('names the formula result that a single Replace skipped', () => {
  const { wb, id, button } = setup(['=10+1']);
  button('Replace').click();
  expect(wb.getCell(id, 0, 0).f).toBe('10+1');
  expect(toast).toHaveBeenCalledWith('A1 is a formula result and was left alone', expect.objectContaining({ icon: 'info' }));
});
