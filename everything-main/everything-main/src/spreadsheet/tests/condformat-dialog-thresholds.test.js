// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

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

function setup(type) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 5; r++) wb.setInput(id, r, 0, String(r + 1));
  const { panel } = openConditionalFormatting({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 4, c2: 0 }), grid: { focus: vi.fn() } });
  const select = panel.querySelector('[aria-label="Condition"]');
  select.value = type;
  select.dispatchEvent(new Event('change'));
  const field = (label) => panel.querySelector(`[aria-label="${label}"]`);
  return { wb, id, field, error: panel.querySelector('.field-error'), submit: () => panel.querySelector('form').requestSubmit() };
}

// Cleared threshold fields read as zero, so an icon set was saved with both thresholds at 0.
it('asks for both icon thresholds when one is left blank', () => {
  const { wb, id, field, error, submit } = setup('icons');
  field('Low threshold percent').value = '';
  field('High threshold percent').value = '';
  submit();
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Enter both thresholds');
  expect(wb.sheet(id).rules).toHaveLength(0);
  field('Low threshold percent').value = '20';
  submit();
  expect(error.textContent).toBe('Enter both thresholds');
  field('High threshold percent').value = '80';
  submit();
  expect(error.hidden).toBe(true);
  expect(wb.sheet(id).rules[0]).toMatchObject({ type: 'icons', lo: 20, hi: 80 });
});

// Top 1.5 was stored and listed as typed while the core took it as Top 1.
it.each(['top', 'bottom'])('asks for a whole number of %s values', (type) => {
  const { wb, id, field, error, submit } = setup(type);
  field('Value').value = '1.5';
  submit();
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Enter how many values, as a whole number of at least 1');
  expect(wb.sheet(id).rules).toHaveLength(0);
  field('Value').value = '0';
  submit();
  expect(error.textContent).toBe('Enter how many values, as a whole number of at least 1');
  field('Value').value = '2';
  submit();
  expect(error.hidden).toBe(true);
  expect(wb.sheet(id).rules[0]).toMatchObject({ type, value: 2 });
});
