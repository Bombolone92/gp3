// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compilePattern, findAll, replaceInText } from '../src/core/search.js';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// A search pattern like (a+)+$ compiled fine and then hung the tab on a 32-character cell: the
// engine tries every split of the text between the two repeats and cannot be interrupted.
describe('a search pattern whose nested repeats could run for ever', () => {
  it('is refused by compilePattern like a syntax error', () => {
    expect(compilePattern('(a+)+$')).toBeNull();
    expect(compilePattern('(a+)+$', { global: true })).toBeNull();
    expect(compilePattern('(\\w+\\s?)*$', { wholeCell: true })).toBeNull();
    expect(compilePattern('a+$')).toBeInstanceOf(RegExp);
    expect(compilePattern('(ab)+c')).toBeInstanceOf(RegExp);
  });

  it('finds and replaces nothing instead of hanging', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, `${'a'.repeat(32)}b`);
    expect(findAll(wb, id, '(a+)+$', { regex: true })).toEqual([]);
    expect(replaceInText('a'.repeat(32), '(a+)+$', 'x', { regex: true })).toBeNull();
  });
});

describe('the find bar', () => {
  let bar;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { bar?.destroy(); vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

  it('says the pattern could run for ever and keeps replacing out of reach', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, `${'a'.repeat(32)}b`);
    const grid = { active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 }, setHighlights: vi.fn(), setSelection: vi.fn(), focus: vi.fn() };
    bar = createFindBar({ wb, grid, sheetId: () => id, activeCell: () => null, announce: vi.fn(), subscribe: () => vi.fn() });
    document.body.append(bar.el);
    bar.open({ replace: true });
    const regex = [...bar.el.querySelectorAll('label')].find((l) => l.textContent === 'Regular expression').querySelector('input');
    regex.checked = true; regex.dispatchEvent(new Event('change'));
    const query = bar.el.querySelector('[aria-label="Find"]');
    query.value = '(a+)+$'; query.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    expect(bar.el.querySelector('.find-count').textContent).toBe('This pattern could run for ever');
    expect(query.getAttribute('aria-invalid')).toBe('true');
    const button = (text) => [...bar.el.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(button('Replace').disabled).toBe(true);
    expect(button('Replace all').disabled).toBe(true);
    // A plain syntax error keeps its own wording.
    query.value = '(a'; query.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    expect(bar.el.querySelector('.find-count').textContent).toBe('Invalid regular expression');
  });
});
