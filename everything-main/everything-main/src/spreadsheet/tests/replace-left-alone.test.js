// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bar?.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); document.body.replaceChildren(); });

function setup(cells, { needle, replacement, prepare = () => {} }) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  cells.forEach((text, r) => wb.setInput(id, r, 0, text));
  prepare(wb, id);
  const grid = { active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 }, setHighlights: vi.fn(), setSelection: vi.fn((s) => { grid.active = s.active; }), focus: vi.fn() };
  bar = createFindBar({ wb, grid, sheetId: () => id, activeCell: () => null, announce: vi.fn(), subscribe: () => vi.fn() });
  document.body.append(bar.el);
  bar.open({ replace: true });
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = needle; query.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  bar.el.querySelector('[aria-label="Replace with"]').value = replacement;
  const button = (text) => [...bar.el.querySelectorAll('button')].find((b) => b.textContent === text);
  return { wb, id, grid, button, count: bar.el.querySelector('.find-count') };
}

// With "Search formulas" on, a formula found by its result, a spilled value, or a number found in its
// formatted text were stepped over, or reported as replaced, without a word about why.
describe('replacing a match that cannot be rewritten while formulas are searched too', () => {
  it('says a formula found by its result was left alone', () => {
    const { wb, id, button, grid } = setup(['=10+1', '11'], { needle: '11', replacement: '9' });
    button('Replace').click();
    expect(wb.getCell(id, 0, 0).f).toBe('10+1');
    expect(toast).toHaveBeenCalledWith('A1 is a formula result and was left alone', expect.objectContaining({ icon: 'info' }));
    expect(grid.active).toEqual({ r: 1, c: 0 });
    button('Replace all').click();
    expect(wb.getValue(id, 1, 0)).toBe(9);
    expect(toast).toHaveBeenLastCalledWith('Replaced 1 cell; 1 formula result left alone', expect.objectContaining({ icon: 'check' }));
  });

  it('says a spilled value was left alone', () => {
    const { wb, id, button } = setup(['=SEQUENCE(3,1,5)'], { needle: '7', replacement: '9' });
    button('Replace').click();
    expect(wb.getValue(id, 2, 0)).toBe(7);
    expect(toast).toHaveBeenCalledWith('A3 is a value spilled by an array formula and was left alone', expect.objectContaining({ icon: 'info' }));
    button('Replace all').click();
    expect(toast).toHaveBeenLastCalledWith('Nothing replaced: the matches are values spilled by array formulas', expect.objectContaining({ icon: 'info' }));
  });

  it('says a number matched only through its number format was left alone, instead of counting it as replaced', () => {
    const { wb, id, button, count } = setup(['1500'], { needle: ',', replacement: '', prepare: (wb, id) => wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency' }) });
    expect(count.textContent).toBe('1 of 1');
    const version = wb.version;
    button('Replace all').click();
    expect(wb.version).toBe(version);
    expect(toast).toHaveBeenLastCalledWith('Nothing replaced: the matches are in how the numbers are formatted, not in their values', expect.objectContaining({ icon: 'info' }));
    button('Replace').click();
    expect(toast).toHaveBeenLastCalledWith('A1 matches only in its number format and was left alone', expect.objectContaining({ icon: 'info' }));
    // Replacing the formatted text with a different amount still changes the value.
    const query = bar.el.querySelector('[aria-label="Find"]');
    query.value = '$1,500.00'; query.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    bar.el.querySelector('[aria-label="Replace with"]').value = '$2,000.00';
    button('Replace all').click();
    expect(wb.getValue(id, 0, 0)).toBe(2000);
    expect(toast).toHaveBeenLastCalledWith('Replaced 1 cell', expect.objectContaining({ icon: 'check' }));
  });

  it('lists every kind left alone after a Replace all that changed nothing', () => {
    const { button } = setup(['=10+1', '=22/2', '11'], { needle: '11', replacement: '9', prepare: (wb, id) => wb.protectRange(id, { r1: 2, c1: 0, r2: 2, c2: 0 }) });
    button('Replace all').click();
    expect(toast).toHaveBeenLastCalledWith('Nothing to replace; 2 formula results, 1 protected cell left alone', expect.objectContaining({ icon: 'info' }));
  });
});
