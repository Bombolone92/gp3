// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Month', 'Sales'], ['Jan', '100'], ['Feb', '200'], ['Mar', '150'], ['Apr', '120']]
    .forEach((row, r) => row.forEach((value, c) => wb.setInput(id, r, c, value)));
  openChartDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 4, c2: 1 }), grid: { focus: vi.fn(), selectChart: vi.fn() } });
  document.querySelector('[data-type="histogram"]').click();
  const bins = document.querySelector('[aria-label="Number of bins"]');
  const setBins = (value) => { bins.value = value; bins.dispatchEvent(new Event('input')); };
  return { wb, id, setBins, error: document.querySelector('.modal-root .field-error'), submit: () => document.querySelector('.modal-root form').requestSubmit() };
}

// A bin count outside 2 to 100, or not a whole number, was dropped without a word: the preview
// and the saved chart used the automatic count while the field kept showing the typed one.
it.each(['150', '1', '2.5', '-3'])('refuses %s bins with a message instead of quietly using the automatic count', (value) => {
  const { wb, id, setBins, error, submit } = setup();
  setBins(value);
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Bins must be a whole number from 2 to 100');
  submit();
  expect(wb.sheet(id).charts).toHaveLength(0);
  setBins('10');
  expect(error.hidden).toBe(true);
  submit();
  expect(wb.sheet(id).charts[0].bins).toBe(10);
});

it('lets a bin count left in the hidden field pass once the chart is of another type', () => {
  const { wb, id, setBins, error, submit } = setup();
  setBins('150');
  document.querySelector('[data-type="column"]').click();
  expect(error.hidden).toBe(true);
  submit();
  expect(wb.sheet(id).charts).toHaveLength(1);
  expect(wb.sheet(id).charts[0].bins ?? null).toBe(null);
});
