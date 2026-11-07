// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let previousLocale;
beforeEach(() => {
  previousLocale = getLocale();
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  setLocale(previousLocale);
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function open(locale) {
  setLocale(locale);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const { panel } = openConditionalFormatting({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 3, c2: 0 }), grid: { focus: vi.fn() } });
  const type = panel.querySelector('select[aria-label="Condition"]');
  const choose = (value) => { type.value = value; type.dispatchEvent(new Event('change', { bubbles: true })); };
  const value1 = panel.querySelector('input[aria-label="Value"]');
  const value2 = panel.querySelector('input[aria-label="Second value"]');
  const error = panel.querySelector('.field-error');
  const submit = () => panel.querySelector('form').requestSubmit();
  return { wb, id, panel, choose, value1, value2, error, submit };
}

// The grid reads 1,5 as one and a half in a comma-decimal locale; the rule's
// value fields refused it, and a saved 1.5 came back written for en-US.
it.each([
  ['de-DE', '1,5', '1.234,5', 'Between 1,5 and 1234,5', '1234,5'],
  ['en-US', '1.5', '1,234.5', 'Between 1.5 and 1234.5', '1234.5'],
])('reads and shows condition values in the %s locale as the grid does', (locale, low, high, described, shownHigh) => {
  const { wb, id, panel, choose, value1, value2, error, submit } = open(locale);
  choose('between');
  value1.value = low;
  value2.value = high;
  submit();
  expect(error.hidden).toBe(true);
  expect(wb.sheet(id).rules).toHaveLength(1);
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'between', value: 1.5, value2: 1234.5 });
  expect(panel.querySelector('.names-ref').textContent).toBe(described);
  panel.querySelector('.names-main').click();
  expect(value1.value).toBe(low);
  expect(value2.value).toBe(shownHigh);
  // Saving the loaded rule unchanged keeps its numbers.
  submit();
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'between', value: 1.5, value2: 1234.5 });
});

it('still refuses text and unbounded numbers in a comma-decimal locale', () => {
  const { wb, id, choose, value1, error, submit } = open('de-DE');
  choose('gt');
  for (const text of ['abc', '1e400', '=A1']) {
    value1.value = text;
    submit();
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/number/i);
    expect(wb.sheet(id).rules).toEqual([]);
  }
  value1.value = '0,5';
  submit();
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'gt', value: 0.5 });
});

it('counts Top N values with the locale reading too', () => {
  const { wb, id, choose, value1, error, submit } = open('de-DE');
  choose('top');
  value1.value = '0,5';
  submit();
  expect(error.hidden).toBe(false);
  expect(error.textContent).toMatch(/at least 1/);
  value1.value = '3';
  submit();
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'top', value: 3 });
});
