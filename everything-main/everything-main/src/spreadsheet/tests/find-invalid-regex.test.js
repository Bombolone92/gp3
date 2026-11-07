// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bar?.destroy(); vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 5, 0, 'Target');
  const grid = { active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 }, setHighlights: vi.fn(), setSelection: vi.fn((s) => { grid.active = s.active; }), focus: vi.fn() };
  let notify = () => {};
  bar = createFindBar({ wb, grid, sheetId: () => id, activeCell: () => null, announce: vi.fn(), subscribe: (fn) => { notify = fn; return vi.fn(); } });
  wb.subscribe?.(() => notify());
  document.body.append(bar.el);
  bar.open({ replace: true });
  const option = (label) => [...bar.el.querySelectorAll('label')].find((l) => l.textContent === label).querySelector('input');
  const query = bar.el.querySelector('[aria-label="Find"]');
  const type = (text) => { query.value = text; query.dispatchEvent(new Event('input')); vi.advanceTimersByTime(150); };
  const button = (text) => [...bar.el.querySelectorAll('button')].find((b) => b.textContent === text);
  return { wb, grid, query, type, option, button, notify: () => notify(), count: bar.el.querySelector('.find-count') };
}

// A pattern that does not compile was reported as "No matches", as if the sheet simply held no such text.
it('reports a pattern that does not compile instead of pretending there are no matches', () => {
  const { query, type, option, button, count } = setup();
  const regex = option('Regular expression');
  regex.checked = true; regex.dispatchEvent(new Event('change'));
  type('Tar(');
  expect(count.textContent).toBe('Invalid regular expression');
  expect(count.classList.contains('none')).toBe(true);
  expect(query.getAttribute('aria-invalid')).toBe('true');
  expect(button('Replace').disabled).toBe(true);
  expect(button('Replace all').disabled).toBe(true);
  // Fixing the pattern clears the state.
  type('Tar.et');
  expect(count.textContent).toBe('1 of 1');
  expect(query.hasAttribute('aria-invalid')).toBe(false);
  expect(button('Replace').disabled).toBe(false);
  expect(button('Replace all').disabled).toBe(false);
});

it('keeps the pattern state when the sheet changes underneath the panel', () => {
  const { wb, query, type, option, count, notify } = setup();
  const regex = option('Regular expression');
  regex.checked = true; regex.dispatchEvent(new Event('change'));
  type('[');
  wb.setInput(wb.activeSheetId, 6, 0, 'More');
  notify();
  expect(count.textContent).toBe('Invalid regular expression');
  expect(query.getAttribute('aria-invalid')).toBe('true');
});

it('treats the same text as literal characters when regular expressions are off', () => {
  const { query, type, count, button } = setup();
  type('Tar(');
  expect(count.textContent).toBe('No matches');
  expect(query.hasAttribute('aria-invalid')).toBe(false);
  expect(button('Replace all').disabled).toBe(true); // There is nothing to replace, though the query is valid.
  type('Target');
  expect(button('Replace all').disabled).toBe(false);
});
