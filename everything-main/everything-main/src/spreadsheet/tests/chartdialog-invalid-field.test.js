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
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Month', 'Sales'], ['Jan', '100'], ['Feb', '200'], ['Mar', '150']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  const { panel } = openChartDialog({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 3, c2: 1 }), grid: { focus: vi.fn(), selectChart: vi.fn() } });
  const field = (label) => panel.querySelector(`[aria-label="${label}"]`);
  const type = (label, value) => { field(label).value = value; field(label).dispatchEvent(new Event('input')); };
  const error = panel.querySelector('.field-error');
  const invalid = () => ['Data range', 'Value axis minimum', 'Value axis maximum', 'Number of bins'].filter((label) => field(label).getAttribute('aria-invalid') === 'true');
  return { wb, id, panel, field, type, error, invalid, submit: () => panel.querySelector('form').requestSubmit() };
}

// Any message from the form marked the Data range field invalid and Insert focused it, even when
// the axis bounds or the bin count were what needed fixing.
it('marks and focuses the axis bound fields, not the range, when the minimum is not below the maximum', () => {
  const { wb, id, field, type, error, invalid, submit } = setup();
  type('Value axis minimum', '10');
  type('Value axis maximum', '5');
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('The axis minimum must be below the maximum');
  expect(invalid()).toEqual(['Value axis minimum', 'Value axis maximum']);
  expect(field('Value axis minimum').getAttribute('aria-describedby')).toBe(error.id);
  expect(field('Data range').hasAttribute('aria-describedby')).toBe(false);
  submit();
  expect(wb.sheet(id).charts).toHaveLength(0);
  expect(document.activeElement).toBe(field('Value axis minimum'));
  type('Value axis maximum', '500');
  expect(error.hidden).toBe(true);
  expect(invalid()).toEqual([]);
  expect(field('Value axis minimum').hasAttribute('aria-describedby')).toBe(false);
  submit();
  expect(wb.sheet(id).charts[0]).toMatchObject({ yMin: 10, yMax: 500 });
});

it('marks and focuses the bins field of a histogram with a bad bin count', () => {
  const { wb, id, panel, field, type, error, invalid, submit } = setup();
  panel.querySelector('[data-type="histogram"]').click();
  type('Number of bins', '1');
  expect(error.textContent).toBe('Bins must be a whole number from 2 to 100');
  expect(invalid()).toEqual(['Number of bins']);
  submit();
  expect(wb.sheet(id).charts).toHaveLength(0);
  expect(document.activeElement).toBe(field('Number of bins'));
});

it('still marks and focuses the range field for a range that cannot be charted', () => {
  const { wb, id, field, type, error, invalid, submit } = setup();
  type('Data range', 'nonsense');
  expect(error.textContent).toBe('Enter a range like A1:B10, or a table name');
  expect(invalid()).toEqual(['Data range']);
  expect(field('Data range').getAttribute('aria-describedby')).toBe(error.id);
  submit();
  expect(wb.sheet(id).charts).toHaveLength(0);
  expect(document.activeElement).toBe(field('Data range'));
});
