// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { ymdToSerial } from '../src/core/format.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A date rule's bounds went through <input type=date> and back: a bound before the calendar's day
// zero (from an imported file) showed as blank and came back as no bound, and a bound with a time of
// day lost it, on a Save that changed nothing. A field saved as it was loaded now keeps its serial.
function open(rule) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const ruleId = wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 3, c2: 0 }, type: 'date', ...rule });
  wb.clearHistory();
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} } });
  panel.querySelector('.names-main').click();
  const field = (label) => panel.querySelector(`[aria-label="${label}"]`);
  const submit = () => panel.querySelector('form').requestSubmit();
  const stored = () => wb.sheet(id).validations.find((v) => v.id === ruleId);
  return { wb, id, panel, field, submit, stored };
}

it('keeps a bound the date field cannot show, and one with a time of day, on a Save that leaves them alone', () => {
  const { field, submit, stored } = open({ min: -5, max: 45000.5 });
  expect(field('Earliest date').value).toBe(''); // before 1899-12-30: nothing a date input can hold
  expect(field('Latest date').value).toBe('2023-03-15');
  submit();
  expect(stored()).toMatchObject({ type: 'date', min: -5, max: 45000.5 });
});

it('still reads a changed or cleared field, and leaves the other bound as it was', () => {
  const { field, submit, stored, panel } = open({ min: -5, max: 45000.5 });
  field('Latest date').value = '2024-01-01';
  submit();
  expect(stored()).toMatchObject({ min: -5, max: ymdToSerial(2024, 1, 1) });
  panel.querySelector('.names-main').click();
  field('Latest date').value = '';
  submit();
  expect(stored()).toMatchObject({ min: -5 });
  expect(stored().max == null).toBe(true);
});

it('reads the fields of a new rule as typed', () => {
  const { wb, id, panel, field, submit } = open({ min: 45000 });
  [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Cancel edit').click();
  field('Apply to range').value = 'B1:B4';
  field('Type').value = 'date';
  field('Type').dispatchEvent(new Event('change'));
  field('Earliest date').value = '2024-01-01';
  submit();
  expect(wb.sheet(id).validations.map((v) => v.min)).toEqual([45000, ymdToSerial(2024, 1, 1)]);
});
