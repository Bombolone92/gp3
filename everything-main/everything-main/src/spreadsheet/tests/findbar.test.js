// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';

let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  bar?.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup() {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 5, 0, 'Target');
  const grid = {
    active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 },
    setHighlights: vi.fn(), setSelection: vi.fn((selection) => { grid.active = selection.active; }), focus: vi.fn(),
  };
  const unsubscribe = vi.fn();
  bar = createFindBar({ wb, grid, sheetId: () => wb.activeSheetId, activeCell: () => null, announce: vi.fn(), subscribe: () => unsubscribe });
  document.body.append(bar.el);
  bar.open();
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = 'Target';
  query.dispatchEvent(new Event('input'));
  return { wb, grid, unsubscribe };
}

describe('pending find searches', () => {
  it('keeps search options compact while exposing custom settings when collapsed', () => {
    setup();
    vi.advanceTimersByTime(150);
    const toggle = bar.el.querySelector('[aria-label="Search options"]');
    const options = bar.el.querySelector('.find-options');
    expect(options.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(options.id);
    expect(toggle.textContent).toBe('Options');
    toggle.click();
    expect(options.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const checkbox = [...options.querySelectorAll('label')].find(label => label.textContent === 'Match case').querySelector('input');
    checkbox.click();
    expect(toggle.textContent).toBe('Options · 1');
    expect(toggle.getAttribute('aria-description')).toBe('Active options: Match case');
    toggle.click();
    expect(options.hidden).toBe(true);
    expect(checkbox.checked).toBe(true);
    bar.close(); bar.open();
    expect(options.hidden).toBe(true);
    expect(toggle.textContent).toBe('Options · 1');
    toggle.click(); checkbox.click();
    expect(toggle.textContent).toBe('Options');
    expect(toggle.getAttribute('aria-description')).toBe('Default search options');
  });

  it('makes automatic selection scope and value-only searches visible in the collapsed summary', () => {
    const { grid } = setup();
    grid.range = { r1: 0, c1: 0, r2: 6, c2: 0 };
    bar.open();
    const toggle = bar.el.querySelector('[aria-label="Search options"]');
    expect(toggle.textContent).toBe('Options · 1');
    expect(toggle.title).toContain('Selection only (A1:A7)');
    toggle.click();
    [...bar.el.querySelectorAll('.find-option')].find(label => label.textContent === 'Search formulas').querySelector('input').click();
    expect(toggle.textContent).toBe('Options · 2');
    expect(toggle.title).toContain('Cell values only');
  });

  it('moves the panel only when the result cannot be uncovered by scrolling, preserving input focus', () => {
    const { grid } = setup();
    bar.el.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 140, height: 140 });
    grid.scrollToActive = vi.fn(() => bar.el.classList.contains('find-bottom'));
    vi.advanceTimersByTime(150);
    expect(grid.scrollToActive).toHaveBeenCalledTimes(2);
    expect(bar.el.classList.contains('find-bottom')).toBe(true);
    expect(document.activeElement).toBe(bar.el.querySelector('[aria-label="Find"]'));
    bar.el.querySelector('[aria-label="Next match"]').click();
    expect(grid.scrollToActive).toHaveBeenCalledTimes(3);
    expect(bar.el.classList.contains('find-bottom')).toBe(true);
    bar.close();
    expect(bar.el.classList.contains('find-bottom')).toBe(false);
  });

  it('keeps the panel in place when neither position can fully reveal an oversized cell', () => {
    const { grid } = setup();
    bar.el.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 140, height: 140 });
    grid.scrollToActive = vi.fn(() => false);
    vi.advanceTimersByTime(150);
    expect(grid.scrollToActive).toHaveBeenCalledTimes(2);
    expect(bar.el.classList.contains('find-bottom')).toBe(false);
  });

  it('advances after replacing a cell even when its replacement still matches', () => {
    const { wb, grid } = setup();
    wb.setInput(wb.activeSheetId, 8, 0, 'Target');
    vi.advanceTimersByTime(150);
    bar.el.querySelector('[aria-label="Show replace"]').click();
    bar.el.querySelector('[aria-label="Replace with"]').value = 'Target suffix';
    const replace = [...bar.el.querySelectorAll('button')].find((button) => button.textContent === 'Replace');
    replace.click();
    expect(grid.active).toEqual({ r: 8, c: 0 });
    expect(bar.el.querySelector('.find-count').textContent).toBe('2 of 2');
    replace.click();
    expect(wb.getValue(wb.activeSheetId, 5, 0)).toBe('Target suffix');
    expect(wb.getValue(wb.activeSheetId, 8, 0)).toBe('Target suffix');
    expect(grid.active).toEqual({ r: 5, c: 0 });
    wb.undo();
    expect(wb.getValue(wb.activeSheetId, 8, 0)).toBe('Target');
  });

  it('wraps to the first match after replacing the last matching cell', () => {
    const { wb, grid } = setup();
    wb.setInput(wb.activeSheetId, 8, 0, 'Target');
    wb.setInput(wb.activeSheetId, 9, 0, 'Target');
    vi.advanceTimersByTime(150);
    bar.el.querySelector('[aria-label="Previous match"]').click();
    expect(grid.active).toEqual({ r: 9, c: 0 });
    bar.el.querySelector('[aria-label="Show replace"]').click();
    bar.el.querySelector('[aria-label="Replace with"]').value = 'Changed';
    [...bar.el.querySelectorAll('button')].find((button) => button.textContent === 'Replace').click();
    expect(grid.active).toEqual({ r: 5, c: 0 });
    expect(bar.el.querySelector('.find-count').textContent).toBe('1 of 2');
  });

  it('uses the latest query when replacing before the search delay finishes', () => {
    const { wb } = setup();
    vi.advanceTimersByTime(150);
    wb.setInput(wb.activeSheetId, 8, 0, 'Other');
    bar.el.querySelector('[aria-label="Show replace"]').click();
    const query = bar.el.querySelector('[aria-label="Find"]');
    query.value = 'Other';
    query.dispatchEvent(new Event('input'));
    bar.el.querySelector('[aria-label="Replace with"]').value = 'Changed';
    [...bar.el.querySelectorAll('button')].find((button) => button.textContent === 'Replace').click();
    expect(wb.getValue(wb.activeSheetId, 8, 0)).toBe('Changed');
    expect(wb.getValue(wb.activeSheetId, 5, 0)).toBe('Target');
    wb.undo();
    expect(wb.getValue(wb.activeSheetId, 8, 0)).toBe('Other');
  });

  it('shows the first new match on immediate Enter, then advances on the next Enter', () => {
    const { wb, grid } = setup();
    vi.advanceTimersByTime(150);
    wb.setInput(wb.activeSheetId, 8, 0, 'Other');
    wb.setInput(wb.activeSheetId, 9, 0, 'Other');
    const query = bar.el.querySelector('[aria-label="Find"]');
    query.value = 'Other';
    query.dispatchEvent(new Event('input'));
    const enter = () => query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    expect(grid.active).toEqual({ r: 8, c: 0 });
    expect(bar.el.querySelector('.find-count').textContent).toBe('1 of 2');
    grid.setSelection.mockClear();
    vi.advanceTimersByTime(150);
    expect(grid.setSelection).not.toHaveBeenCalled();
    enter();
    expect(grid.active).toEqual({ r: 9, c: 0 });
  });

  it('does not select or highlight a match after the panel closes', () => {
    const { grid } = setup();
    bar.close();
    grid.setHighlights.mockClear();
    vi.advanceTimersByTime(150);
    expect(grid.setSelection).not.toHaveBeenCalled();
    expect(grid.setHighlights).not.toHaveBeenCalled();
  });

  it('cancels a pending search when the editor is destroyed', () => {
    const { grid, unsubscribe } = setup();
    bar.destroy();
    vi.advanceTimersByTime(150);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(grid.setSelection).not.toHaveBeenCalled();
  });

  it('still runs debounced searches while the panel is open', () => {
    const { grid } = setup();
    vi.advanceTimersByTime(150);
    expect(grid.setSelection).toHaveBeenCalledOnce();
    expect(grid.setHighlights).toHaveBeenLastCalledWith([{ r: 5, c: 0, sheetId: expect.any(String) }], 0);
  });
});


it('does not navigate or close Find during composition', () => {
  const { grid } = setup();
  const input = bar.el.querySelector('[aria-label="Find"]');
  for (const key of ['Enter', 'Escape']) {
    const event = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(bar.el.hidden).toBe(false);
    expect(grid.setSelection).not.toHaveBeenCalled();
  }
});

it('keeps search feedback associated with the query, and reflects pending, empty and no-match states', () => {
  const { grid } = setup();
  const query = bar.el.querySelector('[aria-label="Find"]');
  const status = bar.el.querySelector('.find-count');
  const next = bar.el.querySelector('[aria-label="Next match"]');
  const type = text => { query.value = text; query.dispatchEvent(new Event('input')); };
  expect(query.getAttribute('aria-describedby')).toBe(status.id);
  expect(status.textContent).toBe('Searching…');
  type('Missing');
  expect(next.disabled).toBe(false); // Can run the new query before its typing delay.
  next.click();
  expect(status.textContent).toBe('No matches');
  expect(next.disabled).toBe(true);
  type('Target');
  next.click();
  expect(grid.active).toEqual({ r: 5, c: 0 });
  expect(status.textContent).toBe('1 of 1');
  expect(next.disabled).toBe(false);
  type('');
  expect(status.hidden).toBe(true);
  expect(next.disabled).toBe(true);
  expect(grid.setHighlights).toHaveBeenLastCalledWith([], -1);
});

it('returns focus to the query when replacing the last match disables the replacement action', () => {
  setup();
  vi.advanceTimersByTime(150);
  bar.el.querySelector('[aria-label="Show replace"]').click();
  bar.el.querySelector('[aria-label="Replace with"]').value = 'Changed';
  const replace = [...bar.el.querySelectorAll('button')].find(b => b.textContent === 'Replace');
  replace.focus(); replace.click();
  expect(replace.disabled).toBe(true);
  expect(document.activeElement).toBe(bar.el.querySelector('[aria-label="Find"]'));
  expect(bar.el.querySelector('.find-count').textContent).toBe('No matches');
});

it('updates unavailable search actions when recalculation changes the matching values', () => {
  const { wb } = setup();
  vi.advanceTimersByTime(150);
  const next = bar.el.querySelector('[aria-label="Next match"]');
  wb.setInput(wb.activeSheetId, 5, 0, 'Changed'); wb.recalculate();
  expect(next.disabled).toBe(true);
  wb.setInput(wb.activeSheetId, 5, 0, 'Target'); wb.recalculate();
  expect(next.disabled).toBe(false);
});
