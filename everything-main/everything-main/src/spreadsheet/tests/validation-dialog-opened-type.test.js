// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function open(type) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 2, c2: 0 }), grid: { focus: vi.fn() } }, type ? { type } : {});
  vi.runAllTimers();
  const typeSelect = panel.querySelector('[aria-label="Type"]');
  const rangeInput = panel.querySelector('[aria-label="Apply to range"]');
  const submit = () => panel.querySelector('form').requestSubmit();
  return { wb, id, panel, typeSelect, rangeInput, submit };
}

// Opened for checkboxes (Insert checkbox), the form went back to Dropdown list after the first
// rule was added, so the next range typed became a list rule.
it('keeps the type the dialog was opened for after a rule is added', () => {
  const { wb, id, typeSelect, rangeInput, submit } = open('checkbox');
  expect(typeSelect.value).toBe('checkbox');
  submit();
  expect(wb.sheet(id).validations.map((v) => v.type)).toEqual(['checkbox']);
  expect(typeSelect.value).toBe('checkbox');
  rangeInput.value = 'B1:B3';
  submit();
  expect(wb.sheet(id).validations.map((v) => v.type)).toEqual(['checkbox', 'checkbox']);
  expect(typeSelect.value).toBe('checkbox');
});

it('starts a general open, and one for a dropdown, on a list rule as before', () => {
  const plain = open(null);
  expect(plain.typeSelect.value).toBe('list');
  closeAllModals();
  vi.runAllTimers();
  document.body.replaceChildren();
  document.body.innerHTML = '<div id="app"></div>';
  const { wb, id, panel, typeSelect, rangeInput, submit } = open('list');
  expect(typeSelect.value).toBe('list');
  expect(document.activeElement).toBe(panel.querySelector('[aria-label="List options"]'));
  panel.querySelector('[aria-label="List options"]').value = 'Yes, No';
  submit();
  expect(wb.sheet(id).validations.map((v) => v.type)).toEqual(['list']);
  expect(typeSelect.value).toBe('list');
  rangeInput.value = 'B1:B3';
  expect(panel.querySelector('[aria-label="List options"]').value).toBe('');
});
