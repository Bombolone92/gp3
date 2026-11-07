// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';
import { findAll, replaceCells } from '../src/core/search.js';
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

describe('replacing where one match is protected', () => {
  const protectFirst = (wb, id) => wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'header');

  // One protected match made the workbook refuse the whole batch, so nothing changed and the toast
  // said every match was protected.
  it('replaces the other matches and counts the protected cell as left alone', () => {
    const { wb, id, button } = setup(['cat', 'cat', 'cat'], { needle: 'cat', replacement: 'dog', prepare: protectFirst });
    button('Replace all').click();
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['cat', 'dog', 'dog']);
    expect(toast).toHaveBeenLastCalledWith('Replaced 2 cells; 1 protected cell left alone', expect.objectContaining({ icon: 'check' }));
    wb.undo();
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['cat', 'cat', 'cat']);
  });

  it('names the protected cell a single Replace stepped over', () => {
    const { wb, id, button, grid } = setup(['cat', 'cat'], { needle: 'cat', replacement: 'dog', prepare: protectFirst });
    button('Replace').click();
    expect(wb.getValue(id, 0, 0)).toBe('cat');
    expect(toast).toHaveBeenCalledWith('A1 is protected and was left alone', expect.objectContaining({ icon: 'lock' }));
    expect(grid.active).toEqual({ r: 1, c: 0 });
  });

  it('still says the matches are protected when every one of them is', () => {
    const { wb, id, button } = setup(['cat', 'cat'], { needle: 'cat', replacement: 'dog', prepare: (wb, id) => wb.setSheetProtected(id, true) });
    button('Replace all').click();
    expect(wb.getValue(id, 1, 0)).toBe('cat');
    expect(toast).toHaveBeenLastCalledWith('Nothing replaced: the matches are protected', expect.objectContaining({ icon: 'lock' }));
  });

  it('leaves protected cells out of the core replacement and reports them when asked', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    ['cat', 'cat', 'cat'].forEach((text, r) => wb.setInput(id, r, 0, text));
    protectFirst(wb, id);
    const skipped = [];
    expect(replaceCells(wb, id, findAll(wb, id, 'cat'), 'cat', 'dog', { skipped })).toBe(2);
    expect(skipped).toEqual([{ r: 0, c: 0, reason: 'protected' }]);
    expect(wb.getValue(id, 0, 0)).toBe('cat');
  });
});
