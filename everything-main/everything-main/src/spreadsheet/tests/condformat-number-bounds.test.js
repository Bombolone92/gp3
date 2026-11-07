// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// "Greater than 1e400" was accepted: the rule stored Infinity, which saves as null and never matches again.
it('refuses a number the rule cannot hold', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  openConditionalFormatting({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 3, c2: 0 }), grid: { focus: vi.fn() } });
  const type = document.querySelector('select[aria-label="Condition"]');
  type.value = 'gt';
  type.dispatchEvent(new Event('change', { bubbles: true }));
  const value = document.querySelector('input[aria-label="Value"]');
  value.value = '1e400';
  document.querySelector('.modal-root form').requestSubmit();
  expect(document.querySelector('.field-error').hidden).toBe(false);
  expect(document.querySelector('.field-error').textContent).toMatch(/number/i);
  expect(wb.sheet(id).rules).toEqual([]);
  value.value = '5';
  document.querySelector('.modal-root form').requestSubmit();
  expect(wb.sheet(id).rules).toHaveLength(1);
  expect(wb.sheet(id).rules[0].value).toBe(5);
});
