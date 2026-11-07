// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
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

function setup(open) {
  const wb = new Workbook({ sheets: [{ name: 'Sheet1' }, { name: 'Sheet2' }] });
  const id = wb.sheets[0].id;
  const { panel } = open({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 4, c2: 0 }), grid: { focus: vi.fn() } });
  return {
    error: panel.querySelector('.field-error'),
    save: (range) => { panel.querySelector('[aria-label="Apply to range"]').value = range; panel.querySelector('form').requestSubmit(); },
  };
}

// A range on another sheet, which these rules cannot take, drew the "Enter a range like…" hint for
// text that does not read as a range; the table and protect dialogs already say which it is.
it.each([
  ['conditional formatting', (ctx) => { const modal = openConditionalFormatting(ctx); modal.panel.querySelector('[aria-label="Value"]').value = '3'; return modal; }, 'Enter a range like B2:B20, a table column like Sales[Amount], or separate areas like B2:B20,D2:D20'],
  ['data validation', (ctx) => { const modal = openValidationManager(ctx); modal.panel.querySelector('[aria-label="List options"]').value = 'Yes, No'; return modal; }, 'Enter a range like B2:B20, or a table column like Sales[Item]'],
])('the %s dialog says a range on another sheet is not on this one', (_, open, hint) => {
  const { error, save } = setup(open);
  save('Sheet2!A1:A5');
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Enter a range on this sheet');
  save('nope');
  expect(error.textContent).toBe(hint);
  save('Sheet1!A1:A5');
  expect(error.hidden).toBe(true);
});
